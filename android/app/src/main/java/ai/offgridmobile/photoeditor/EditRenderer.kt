package ai.offgridmobile.photoeditor

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

class LowMemoryException(message: String) : Exception(message)

data class EditOutput(
    val resultPath: String,
    val previewPath: String,
    val decodeMs: Long,
    val maskMs: Long,
    val modelMs: Long,
    val blendMs: Long,
    val encodeMs: Long,
    val cropW: Int,
    val cropH: Int,
)

/**
 * Applies a region edit to the full-resolution current result and writes a NEW result file
 * (never the original). Pixels outside the painted area are carried over, but the file is
 * re-encoded as JPEG (quality 95) because the edited area has to be written somewhere.
 */
object EditRenderer {
    private const val JPEG_QUALITY = 95
    /** Rough peak for the model run (weights + activations) in bytes. */
    private const val MODEL_HEADROOM = 900L * 1024 * 1024

    fun checkMemory(context: Context, width: Int, height: Int) {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        // The full photo bitmap twice over (decode + working copies) plus the model.
        val needed = width.toLong() * height * 4 * 2 + MODEL_HEADROOM
        if (info.availMem - info.threshold < needed) {
            throw LowMemoryException(
                "Not enough free memory for this edit: it needs about ${needed / (1 shl 20)} MB, " +
                    "${(info.availMem - info.threshold) / (1 shl 20)} MB is free.",
            )
        }
    }

    fun applyRegion(
        context: Context, sourcePath: String, originalPath: String, strokes: List<Stroke>,
        outDir: File, outName: String, engineSize: Int, model: (Bitmap, Bitmap) -> Bitmap,
    ): EditOutput {
        val original = File(originalPath)
        val orientation = PhotoImporter.orientationOf(original)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(sourcePath, bounds)
        checkMemory(context, bounds.outWidth, bounds.outHeight)

        var t = System.currentTimeMillis()
        val image = BitmapFactory.decodeFile(sourcePath, BitmapFactory.Options().apply {
            inMutable = true; inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw IllegalStateException("Could not read the photo.")
        val decodeMs = System.currentTimeMillis() - t
        try {
            val map = OrientationMap(image.width, image.height, orientation)
            val result = RegionPipeline.process(image, strokes, map, engineSize, model)

            t = System.currentTimeMillis()
            outDir.mkdirs()
            val out = File(outDir, "$outName.jpg")
            FileOutputStream(out).use { image.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
            PhotoSaver.copyExif(original, out) // keeps orientation so the raw pixels display upright
            val preview = File(outDir, "${outName}_preview.jpg")
            PhotoImporter.writeUprightPreview(image, orientation, preview)
            val encodeMs = System.currentTimeMillis() - t

            return EditOutput(
                out.absolutePath, preview.absolutePath, decodeMs,
                result.timings.maskMs, result.timings.modelMs, result.timings.blendMs, encodeMs,
                result.crop.width(), result.crop.height(),
            )
        } finally {
            image.recycle()
        }
    }
}
