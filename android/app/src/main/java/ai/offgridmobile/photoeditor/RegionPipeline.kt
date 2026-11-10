package ai.offgridmobile.photoeditor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.media.ExifInterface
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** One mask stroke in normalised UPRIGHT image coordinates (what the user saw). */
data class Stroke(val erase: Boolean, val size: Float, val points: FloatArray)

/**
 * Maps the upright image the user painted on to the stored (raw) pixel grid, which may be
 * rotated or mirrored by its EXIF orientation. Edits happen in raw pixels so the file keeps
 * its orientation tag and is never rotated (a rotation would double peak memory).
 */
class OrientationMap(rawW: Int, rawH: Int, orientation: Int) {
    val uprightW: Int
    val uprightH: Int
    /** Upright pixel coordinates to raw pixel coordinates. */
    val toRaw = Matrix()

    init {
        val display = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> display.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> display.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> display.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> display.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> display.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { display.postRotate(90f); display.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { display.postRotate(270f); display.postScale(-1f, 1f) }
        }
        val bounds = RectF(0f, 0f, rawW.toFloat(), rawH.toFloat())
        display.mapRect(bounds)
        display.postTranslate(-bounds.left, -bounds.top)
        uprightW = bounds.width().roundToInt()
        uprightH = bounds.height().roundToInt()
        display.invert(toRaw)
    }
}

/**
 * Crop, process and paste back (plan section 5.2). Every region tool calls this, so a
 * full-resolution photo goes through a 512 px model and only the painted area changes.
 */
object RegionPipeline {
    /** Extra context around the painted area, as a fraction of its size on each side. */
    const val DEFAULT_PADDING = 0.3f
    /** Smallest crop side in raw pixels, so tiny marks still get surrounding context. */
    const val MIN_CROP = 384

    data class Timings(var maskMs: Long = 0, var modelMs: Long = 0, var blendMs: Long = 0)

    data class Result(val crop: Rect, val timings: Timings)

    /**
     * Paints strokes into [canvas]. [transform] maps normalised upright coords to canvas pixels;
     * [widthScale] turns a stroke size (fraction of image width) into canvas pixels.
     */
    fun drawStrokes(canvas: Canvas, strokes: List<Stroke>, transform: Matrix, widthScale: Float, extraWidthPx: Float = 0f) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
        }
        for (s in strokes) {
            val path = Path()
            val pts = s.points
            if (pts.size < 2) continue
            path.moveTo(pts[0], pts[1])
            if (pts.size == 2) path.lineTo(pts[0] + 1e-4f, pts[1])
            var i = 2
            while (i + 1 < pts.size) { path.lineTo(pts[i], pts[i + 1]); i += 2 }
            path.transform(transform)
            paint.strokeWidth = s.size * widthScale + (if (s.erase) 0f else extraWidthPx)
            paint.color = Color.WHITE
            paint.xfermode = if (s.erase) PorterDuffXfermode(PorterDuff.Mode.CLEAR) else null
            canvas.drawPath(path, paint)
        }
    }

    /** Normalised upright coords to raw pixels. */
    fun normToRaw(map: OrientationMap): Matrix = Matrix().apply {
        setScale(map.uprightW.toFloat(), map.uprightH.toFloat())
        postConcat(map.toRaw)
    }

    /** Bounding box (raw pixels) of the brush strokes, or null if nothing is painted. */
    fun maskBounds(strokes: List<Stroke>, map: OrientationMap): RectF? {
        val brushes = strokes.filter { !it.erase }
        if (brushes.isEmpty()) return null
        val toRaw = normToRaw(map)
        var box: RectF? = null
        for (s in brushes) {
            val half = s.size * map.uprightW / 2f
            val pts = s.points.copyOf()
            toRaw.mapPoints(pts)
            var i = 0
            while (i + 1 < pts.size) {
                val r = RectF(pts[i] - half, pts[i + 1] - half, pts[i] + half, pts[i + 1] + half)
                box = box?.apply { union(r) } ?: r
                i += 2
            }
        }
        return box
    }

    /** Square crop around [box] with padding, clamped to the image. */
    fun cropFor(box: RectF, imageW: Int, imageH: Int, padding: Float = DEFAULT_PADDING): Rect {
        val side = max(max(box.width(), box.height()) * (1 + 2 * padding), MIN_CROP.toFloat()).roundToInt()
        if (side <= min(imageW, imageH)) {
            val left = (box.centerX() - side / 2f).roundToInt().coerceIn(0, imageW - side)
            val top = (box.centerY() - side / 2f).roundToInt().coerceIn(0, imageH - side)
            return Rect(left, top, left + side, top + side)
        }
        // Painted area too big for a square inside the photo: pad and clamp (the model input stretches a little).
        val padX = box.width() * padding; val padY = box.height() * padding
        return Rect(
            max(0, (box.left - padX).toInt()), max(0, (box.top - padY).toInt()),
            min(imageW, ceil(box.right + padX).toInt()), min(imageH, ceil(box.bottom + padY).toInt()),
        )
    }

    /**
     * Runs [model] on the painted region of [image] (mutable, raw orientation) and blends the
     * result back in place. [model] receives a [size]x[size] crop and a mask where white = fill.
     */
    fun process(
        image: Bitmap, strokes: List<Stroke>, map: OrientationMap, size: Int,
        model: (crop: Bitmap, mask: Bitmap) -> Bitmap,
    ): Result {
        val timings = Timings()
        var t = System.currentTimeMillis()
        val box = maskBounds(strokes, map) ?: throw IllegalArgumentException("Paint over the area first.")
        val crop = cropFor(box, image.width, image.height)
        val toRaw = normToRaw(map)

        // Model inputs: the crop scaled to the engine size, and the mask drawn straight at that size,
        // grown a little so the model also rebuilds the object's soft edge.
        val cropBmp = Bitmap.createBitmap(image, crop.left, crop.top, crop.width(), crop.height())
        val modelIn = Bitmap.createScaledBitmap(cropBmp, size, size, true)
        if (modelIn !== cropBmp) cropBmp.recycle()
        val toModel = Matrix(toRaw).apply {
            postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
            postScale(size.toFloat() / crop.width(), size.toFloat() / crop.height())
        }
        val maskIn = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(maskIn), strokes, toModel, map.uprightW * size.toFloat() / crop.width(), extraWidthPx = size * 0.02f)
        timings.maskMs = System.currentTimeMillis() - t

        t = System.currentTimeMillis()
        val generated = model(modelIn, maskIn)
        modelIn.recycle(); maskIn.recycle()
        timings.modelMs = System.currentTimeMillis() - t

        t = System.currentTimeMillis()
        blend(image, generated, crop, strokes, toRaw, map.uprightW)
        generated.recycle()
        timings.blendMs = System.currentTimeMillis() - t
        return Result(crop, timings)
    }

    /**
     * Pastes [generated] over [crop] through a dilated, feathered copy of the mask, so only
     * the painted area changes and the edge is invisible.
     */
    private fun blend(image: Bitmap, generated: Bitmap, crop: Rect, strokes: List<Stroke>, toRaw: Matrix, uprightW: Int) {
        val w = crop.width(); val h = crop.height()
        val feather = max(2f, max(w, h) * 0.012f)
        // Draw the mask small and scale it up with filtering: a cheap, smooth feather.
        val small = max(1f, feather / 2f)
        val sw = max(1, (w / small).roundToInt()); val sh = max(1, (h / small).roundToInt())
        val toSmall = Matrix(toRaw).apply {
            postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
            postScale(sw.toFloat() / w, sh.toFloat() / h)
        }
        val maskSmall = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(maskSmall), strokes, toSmall, uprightW * sw.toFloat() / w, extraWidthPx = 2f)
        val alpha = Bitmap.createScaledBitmap(maskSmall, w, h, true)
        if (alpha !== maskSmall) maskSmall.recycle()

        val patch = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(patch)
        canvas.drawBitmap(generated, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
        canvas.drawBitmap(alpha, 0f, 0f, Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) })
        alpha.recycle()
        Canvas(image).drawBitmap(patch, crop.left.toFloat(), crop.top.toFloat(), Paint())
        patch.recycle()
    }
}
