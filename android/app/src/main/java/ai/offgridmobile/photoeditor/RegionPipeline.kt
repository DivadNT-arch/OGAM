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

/**
 * One mask stroke in normalised UPRIGHT image coordinates (what the user saw). A [rect] stroke
 * is a filled box with corners (points[0], points[1]) and (points[2], points[3]).
 */
data class Stroke(val erase: Boolean, val size: Float, val points: FloatArray, val rect: Boolean = false)

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
            if (s.rect && pts.size >= 4) {
                path.moveTo(pts[0], pts[1]); path.lineTo(pts[2], pts[1]); path.lineTo(pts[2], pts[3]); path.lineTo(pts[0], pts[3]); path.close()
                path.transform(transform)
                paint.style = if (extraWidthPx > 0f && !s.erase) Paint.Style.FILL_AND_STROKE else Paint.Style.FILL
                paint.strokeWidth = if (s.erase) 0f else extraWidthPx
                paint.color = Color.WHITE
                paint.xfermode = if (s.erase) PorterDuffXfermode(PorterDuff.Mode.CLEAR) else null
                canvas.drawPath(path, paint)
                paint.style = Paint.Style.STROKE
                continue
            }
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
        // Plain min/max: RectF.union ignores zero-size rects, which a box's corner points are.
        var l = Float.MAX_VALUE; var t = Float.MAX_VALUE; var r = -Float.MAX_VALUE; var b = -Float.MAX_VALUE
        for (s in brushes) {
            val half = if (s.rect) 0f else s.size * map.uprightW / 2f
            val pts = s.points.copyOf()
            toRaw.mapPoints(pts)
            var i = 0
            while (i + 1 < pts.size) {
                l = min(l, pts[i] - half); t = min(t, pts[i + 1] - half)
                r = max(r, pts[i] + half); b = max(b, pts[i + 1] + half)
                i += 2
            }
        }
        val box = RectF(l, t, max(r, l + 1f), max(b, t + 1f))
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

    /** Paint is grown by this fraction of the crop before the model runs, to catch leftover edges. */
    const val MASK_GROW = 0.015f
    /** How much of the missing fine texture is added back as grain (0 = none, 1 = full). */
    const val GRAIN_STRENGTH = 0.6f
    /** Larger tone differences are real content changes, not lighting drift; leave them alone. */
    const val MAX_TONE_SHIFT = 24
    /** Edge softness as a fraction of the crop. Fill uses a wider edge: its new content rarely matches exactly. */
    const val DEFAULT_FEATHER = 0.012f
    const val FILL_FEATHER = 0.03f

    /**
     * Runs [model] on the painted region of [image] (mutable, raw orientation) and blends the
     * result back in place. [sizeFor] picks the model input size from the crop's longest side.
     * The crop keeps its shape: it is scaled to fit and the rest is filled with mirrored image.
     * [model] receives a square crop and a mask (white = fill) of that size.
     */
    fun process(
        image: Bitmap, strokes: List<Stroke>, map: OrientationMap, sizeFor: (Int) -> Int,
        feather: Float = DEFAULT_FEATHER,
        model: (crop: Bitmap, mask: Bitmap) -> Bitmap,
    ): Result {
        val timings = Timings()
        var t = System.currentTimeMillis()
        val box = maskBounds(strokes, map) ?: throw IllegalArgumentException("Paint over the area first.")
        val crop = cropFor(box, image.width, image.height)
        val toRaw = normToRaw(map)
        val size = sizeFor(max(crop.width(), crop.height()))
        val scale = size.toFloat() / max(crop.width(), crop.height())
        val nw = max(1, (crop.width() * scale).roundToInt()).coerceAtMost(size)
        val nh = max(1, (crop.height() * scale).roundToInt()).coerceAtMost(size)

        val cropBmp = Bitmap.createBitmap(image, crop.left, crop.top, crop.width(), crop.height())
        val fitted = Bitmap.createScaledBitmap(cropBmp, nw, nh, true)
        if (fitted !== cropBmp) cropBmp.recycle()
        val modelIn = mirrorPad(fitted, size)
        fitted.recycle()
        val toModel = Matrix(toRaw).apply {
            postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
            postScale(scale, scale)
        }
        val maskIn = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(maskIn), strokes, toModel, map.uprightW * scale, extraWidthPx = size * MASK_GROW * 2)
        timings.maskMs = System.currentTimeMillis() - t

        t = System.currentTimeMillis()
        val generated = model(modelIn, maskIn)
        modelIn.recycle(); maskIn.recycle()
        timings.modelMs = System.currentTimeMillis() - t

        t = System.currentTimeMillis()
        blend(image, generated, Rect(0, 0, nw, nh), crop, strokes, toRaw, map.uprightW, feather)
        generated.recycle()
        timings.blendMs = System.currentTimeMillis() - t
        return Result(crop, timings)
    }

    /** Places [src] at the top-left of a [size] square and fills the rest with mirror copies. */
    fun mirrorPad(src: Bitmap, size: Int): Bitmap {
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val w = src.width; val h = src.height
        var y = 0; var flipY = false
        while (y < size) {
            var x = 0; var flipX = false
            while (x < size) {
                val m = Matrix().apply {
                    postScale(if (flipX) -1f else 1f, if (flipY) -1f else 1f)
                    postTranslate((if (flipX) x + w else x).toFloat(), (if (flipY) y + h else y).toFloat())
                }
                c.drawBitmap(src, m, Paint(Paint.FILTER_BITMAP_FLAG))
                x += w; flipX = !flipX
            }
            y += h; flipY = !flipY
        }
        return out
    }

    /**
     * Pastes [generated] (the [src] part of it) over [crop] through a dilated, feathered copy of
     * the mask, so only the painted area changes and the edge is invisible. Before pasting, the
     * fill's tone is matched to its surroundings and missing fine texture is added back as grain.
     */
    private fun blend(
        image: Bitmap, generated: Bitmap, src: Rect, crop: Rect, strokes: List<Stroke>, toRaw: Matrix, uprightW: Int,
        featherFraction: Float,
    ) {
        val w = crop.width(); val h = crop.height()
        val feather = max(2f, max(w, h) * featherFraction)
        // Draw the mask small and scale it up with filtering: a cheap, smooth feather.
        val small = max(1f, feather / 2f)
        val sw = max(1, (w / small).roundToInt()); val sh = max(1, (h / small).roundToInt())
        val toSmall = Matrix(toRaw).apply {
            postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
            postScale(sw.toFloat() / w, sh.toFloat() / h)
        }
        val widthSmall = uprightW * sw.toFloat() / w
        val growPx = max(w, h) * MASK_GROW * sw / w
        val maskSmall = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(maskSmall), strokes, toSmall, widthSmall, extraWidthPx = 2f + growPx * 2)
        val alpha = Bitmap.createScaledBitmap(maskSmall, w, h, true)
        // A wider band around the paint: the "surroundings" used for tone and grain.
        val ringSmall = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
        drawStrokes(Canvas(ringSmall), strokes, toSmall, widthSmall, extraWidthPx = 2f + growPx * 2 + max(sw, sh) * 0.08f)

        val patch = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(patch).drawBitmap(generated, src, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG))
        matchToneAndGrain(image, patch, crop, maskSmall, ringSmall)
        maskSmall.recycle(); ringSmall.recycle()
        Canvas(patch).drawBitmap(alpha, 0f, 0f, Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) })
        alpha.recycle()
        Canvas(image).drawBitmap(patch, crop.left.toFloat(), crop.top.toFloat(), Paint())
        patch.recycle()
    }

    private fun luma(c: Int) = (Color.red(c) * 299 + Color.green(c) * 587 + Color.blue(c) * 114) / 1000

    /** Shifts [patch] towards the surroundings' average colour and adds grain to match their texture. */
    private fun matchToneAndGrain(image: Bitmap, patch: Bitmap, crop: Rect, maskSmall: Bitmap, ringSmall: Bitmap) {
        val w = patch.width; val h = patch.height
        val sw = maskSmall.width; val sh = maskSmall.height
        val inner = IntArray(sw * sh).also { maskSmall.getPixels(it, 0, sw, 0, 0, sw, sh) }
        val ring = IntArray(sw * sh).also { ringSmall.getPixels(it, 0, sw, 0, 0, sw, sh) }
        val rnd = java.util.SplittableRandom(42)
        val sumO = DoubleArray(3); val sumF = DoubleArray(3); var nO = 0; var nF = 0
        var dO = 0.0; var dF = 0.0; var cO = 0; var cF = 0
        // Sample pixels: ring pixels (outside the paint) describe the surroundings, inner ones the fill.
        repeat(60_000) {
            val x = rnd.nextInt(w - 1); val y = rnd.nextInt(h)
            val idx = min(sh - 1, y * sh / h) * sw + min(sw - 1, x * sw / w)
            val inPaint = Color.alpha(inner[idx]) > 200
            val inRing = !inPaint && Color.alpha(ring[idx]) > 200 && Color.alpha(inner[idx]) < 10
            if (inRing) {
                val a = image.getPixel(crop.left + x, crop.top + y); val b = image.getPixel(crop.left + x + 1, crop.top + y)
                sumO[0] += Color.red(a).toDouble(); sumO[1] += Color.green(a).toDouble(); sumO[2] += Color.blue(a).toDouble(); nO++
                val d = (luma(a) - luma(b)).toDouble(); dO += d * d; cO++
            } else if (inPaint) {
                val a = patch.getPixel(x, y); val b = patch.getPixel(x + 1, y)
                sumF[0] += Color.red(a).toDouble(); sumF[1] += Color.green(a).toDouble(); sumF[2] += Color.blue(a).toDouble(); nF++
                val d = (luma(a) - luma(b)).toDouble(); dF += d * d; cF++
            }
        }
        if (nO < 200 || nF < 200) return
        val shift = IntArray(3) { ((sumO[it] / nO - sumF[it] / nF)).roundToInt() }
        val applyShift = shift.all { kotlin.math.abs(it) <= MAX_TONE_SHIFT }
        // Neighbour differences of independent noise have twice its variance.
        val wanted = kotlin.math.sqrt(dO / cO / 2); val have = kotlin.math.sqrt(dF / cF / 2)
        val grain = (kotlin.math.sqrt(max(0.0, wanted * wanted - have * have)) * GRAIN_STRENGTH).toFloat()
        if (!applyShift && grain < 0.5f) return
        val px = IntArray(w)
        val noise = java.util.SplittableRandom(7)
        for (y in 0 until h) {
            patch.getPixels(px, 0, w, 0, y, w, 1)
            for (x in 0 until w) {
                val c = px[x]
                val n = if (grain >= 0.5f) (noise.nextDouble() + noise.nextDouble() + noise.nextDouble() - 1.5) * 2 * grain else 0.0
                val r = Color.red(c) + (if (applyShift) shift[0] else 0) + n
                val g = Color.green(c) + (if (applyShift) shift[1] else 0) + n
                val b = Color.blue(c) + (if (applyShift) shift[2] else 0) + n
                px[x] = Color.rgb(r.roundToInt().coerceIn(0, 255), g.roundToInt().coerceIn(0, 255), b.roundToInt().coerceIn(0, 255))
            }
            patch.setPixels(px, 0, w, 0, y, w, 1)
        }
    }
}
