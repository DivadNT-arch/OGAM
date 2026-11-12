package ai.offgridmobile.photoeditor

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Real-ESRGAN (realesr-general-x4v3) through ONNX Runtime on the CPU. The photo is processed
 * in overlapping tiles so memory stays small; each tile is upscaled 4x, then scaled to the
 * requested factor and mixed with a plain enlargement by [detail] (0 = plain, 1 = full ESRGAN).
 */
class UpscaleEngine(modelFile: File, threads: Int) {
    companion object {
        const val TILE = 384
        /** Context around each tile, cut off after upscaling. 34 px covers the network's full reach: tiled output then matches a whole-image run exactly (checked on a real photo). */
        const val PAD = 34
        /** Largest output the editor makes (pixels): about 64 MP, a 256 MB bitmap. */
        const val MAX_OUTPUT_PIXELS = 64_000_000L
    }

    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(modelFile.absolutePath, OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    })
    @Volatile private var runOptions: OrtSession.RunOptions? = null
    @Volatile private var cancelled = false

    fun cancel() { cancelled = true; runOptions?.setTerminate(true) }

    fun tileCount(width: Int, height: Int): Int = ceil(width / TILE.toDouble()).toInt() * ceil(height / TILE.toDouble()).toInt()

    /** Upscales [src] by [factor] (2 or 4). [onTile] gets (tilesDone, tilesTotal). */
    fun upscale(src: Bitmap, factor: Int, detail: Float, onTile: (Int, Int) -> Unit): Bitmap {
        cancelled = false
        val out = Bitmap.createBitmap(src.width * factor, src.height * factor, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val plainPaint = Paint(Paint.FILTER_BITMAP_FLAG)
        val aiPaint = Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = (detail.coerceIn(0f, 1f) * 255).roundToInt() }
        val total = tileCount(src.width, src.height)
        var done = 0
        var y = 0
        while (y < src.height) {
            var x = 0
            while (x < src.width) {
                if (cancelled) throw InterruptedException("Cancelled.")
                val tw = min(TILE, src.width - x); val th = min(TILE, src.height - y)
                // Tile with context padding, clamped to the photo.
                val px0 = maxOf(0, x - PAD); val py0 = maxOf(0, y - PAD)
                val px1 = min(src.width, x + tw + PAD); val py1 = min(src.height, y + th + PAD)
                val padded = Bitmap.createBitmap(src, px0, py0, px1 - px0, py1 - py0)
                val up4 = run4x(padded)
                padded.recycle()
                // The part of the 4x result that belongs to this tile (without the padding).
                val srcRect = Rect((x - px0) * 4, (y - py0) * 4, (x - px0 + tw) * 4, (y - py0 + th) * 4)
                val dst = Rect(x * factor, y * factor, (x + tw) * factor, (y + th) * factor)
                // Plain enlargement underneath, the AI result on top at the chosen strength.
                canvas.drawBitmap(src, Rect(x, y, x + tw, y + th), dst, plainPaint)
                canvas.drawBitmap(up4, srcRect, dst, aiPaint)
                up4.recycle()
                done++
                onTile(done, total)
                x += TILE
            }
            y += TILE
        }
        return out
    }

    private fun run4x(tile: Bitmap): Bitmap {
        val w = tile.width; val h = tile.height; val n = w * h
        val px = IntArray(n).also { tile.getPixels(it, 0, w, 0, 0, w, h) }
        val input = FloatBuffer.allocate(3 * n)
        for (i in 0 until n) {
            val c = px[i]
            input.put(i, Color.red(c) / 255f); input.put(n + i, Color.green(c) / 255f); input.put(2 * n + i, Color.blue(c) / 255f)
        }
        val options = OrtSession.RunOptions()
        runOptions = options
        try {
            OnnxTensor.createTensor(env, input, longArrayOf(1, 3, h.toLong(), w.toLong())).use { t ->
                session.run(mapOf("input" to t), options).use { result ->
                    val o = (result[0] as OnnxTensor).floatBuffer
                    val ow = w * 4; val oh = h * 4; val on = ow * oh
                    val pixels = IntArray(on)
                    for (i in 0 until on) {
                        val r = (o.get(i) * 255f).roundToInt().coerceIn(0, 255)
                        val g = (o.get(on + i) * 255f).roundToInt().coerceIn(0, 255)
                        val b = (o.get(2 * on + i) * 255f).roundToInt().coerceIn(0, 255)
                        pixels[i] = Color.rgb(r, g, b)
                    }
                    return Bitmap.createBitmap(pixels, ow, oh, Bitmap.Config.ARGB_8888)
                }
            }
        } finally {
            runOptions = null
            options.close()
        }
    }

    fun close() { session.close() }
}
