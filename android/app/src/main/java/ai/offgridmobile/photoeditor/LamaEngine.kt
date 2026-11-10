package ai.offgridmobile.photoeditor

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.graphics.Color
import java.io.File
import java.nio.FloatBuffer

/**
 * LaMa inpainting through ONNX Runtime on the CPU. Input: RGB 0..1 and a mask (1 = fill),
 * both [size]x[size] NCHW (512 or 1024, fixed per model file). Output: RGB 0..255. The session stays loaded between edits and is
 * released with [close] (on unload or memory pressure).
 */
class LamaEngine(private val modelFile: File, private val threads: Int, val size: Int) {

    private val env = OrtEnvironment.getEnvironment()
    private val session: OrtSession = env.createSession(modelFile.absolutePath, OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
    })
    @Volatile private var runOptions: OrtSession.RunOptions? = null

    /** Stops a running inference from another thread; the run then throws. */
    fun cancel() { runOptions?.setTerminate(true) }

    fun inpaint(image: Bitmap, mask: Bitmap): Bitmap {
        val SIZE = size
        require(image.width == SIZE && image.height == SIZE && mask.width == SIZE && mask.height == SIZE)
        val n = SIZE * SIZE
        val px = IntArray(n).also { image.getPixels(it, 0, SIZE, 0, 0, SIZE, SIZE) }
        val mp = IntArray(n).also { mask.getPixels(it, 0, SIZE, 0, 0, SIZE, SIZE) }
        val img = FloatBuffer.allocate(3 * n)
        val msk = FloatBuffer.allocate(n)
        for (i in 0 until n) {
            val c = px[i]
            img.put(i, Color.red(c) / 255f); img.put(n + i, Color.green(c) / 255f); img.put(2 * n + i, Color.blue(c) / 255f)
            msk.put(i, if (Color.alpha(mp[i]) > 127) 1f else 0f)
        }
        val shapeImg = longArrayOf(1, 3, SIZE.toLong(), SIZE.toLong())
        val shapeMask = longArrayOf(1, 1, SIZE.toLong(), SIZE.toLong())
        val options = OrtSession.RunOptions()
        runOptions = options
        try {
            OnnxTensor.createTensor(env, img, shapeImg).use { ti ->
                OnnxTensor.createTensor(env, msk, shapeMask).use { tm ->
                    session.run(mapOf("image" to ti, "mask" to tm), options).use { result ->
                        val out = (result[0] as OnnxTensor).floatBuffer
                        val pixels = IntArray(n)
                        for (i in 0 until n) {
                            val r = out.get(i).toInt().coerceIn(0, 255)
                            val g = out.get(n + i).toInt().coerceIn(0, 255)
                            val b = out.get(2 * n + i).toInt().coerceIn(0, 255)
                            pixels[i] = Color.rgb(r, g, b)
                        }
                        return Bitmap.createBitmap(pixels, SIZE, SIZE, Bitmap.Config.ARGB_8888)
                    }
                }
            }
        } finally {
            runOptions = null
            options.close()
        }
    }

    fun close() { session.close() }
}
