package ai.offgridmobile.photoeditor

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Settings for one Fill run (Stable Diffusion inpainting through the local-dream server). */
data class FillRequest(
    val prompt: String,
    val negativePrompt: String,
    /** 0..1: how much of the painted area is regenerated (1 = ignore what was there). */
    val strength: Float,
    val steps: Int,
    val guidance: Float,
    val seed: Long,
)

/**
 * Talks to the local-dream server that Off Grid's LocalDreamModule already runs on this phone
 * (127.0.0.1, CPU/MNN). Off Grid keeps owning the server and its model; this only sends
 * inpainting requests to it, so no upstream code changes are needed.
 *
 * Request format (local-dream /generate): `image` and `mask` are base64 PNGs at the request
 * size, mask white = regenerate. The reply is a server-sent event stream with `progress`
 * events and a final `complete` event holding raw RGB (base64).
 */
class LocalDreamFillClient(private val port: Int) {
    companion object {
        const val SIZE = 512

        /** img2img and inpainting need the model's VAE encoder (`vae_encoder.mnn`). */
        fun hasVaeEncoder(modelPath: String): Boolean =
            File(modelPath).walkTopDown().maxDepth(3).any { it.name == "vae_encoder.mnn" }
    }

    @Volatile private var connection: HttpURLConnection? = null
    @Volatile private var cancelled = false

    fun cancel() {
        cancelled = true
        try { connection?.disconnect() } catch (_: Exception) {}
    }

    fun isServerUp(): Boolean = try {
        (URL("http://127.0.0.1:$port/health").openConnection() as HttpURLConnection).run {
            connectTimeout = 2000; readTimeout = 2000
            val ok = responseCode == 200
            disconnect(); ok
        }
    } catch (_: Exception) { false }

    private fun pngBase64(bitmap: Bitmap): String {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /** The pipeline's mask is white strokes on transparent; local-dream wants white on black. */
    private fun opaqueMask(mask: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(mask.width, mask.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.drawColor(Color.BLACK)
        c.drawBitmap(mask, 0f, 0f, null)
        return out
    }

    /** Runs one inpainting pass on a [SIZE] square crop. [onStep] gets (step, totalSteps). */
    fun inpaint(crop: Bitmap, mask: Bitmap, request: FillRequest, onStep: (Int, Int) -> Unit): Bitmap {
        if (cancelled) throw InterruptedException("Cancelled.")
        require(crop.width == SIZE && crop.height == SIZE)
        val solidMask = opaqueMask(mask)
        val body = JSONObject().apply {
            put("prompt", request.prompt)
            put("negative_prompt", request.negativePrompt)
            put("steps", request.steps)
            put("cfg", request.guidance.toDouble())
            put("seed", request.seed and 0x7fffffff)
            put("width", SIZE)
            put("height", SIZE)
            put("scheduler", "dpm")
            put("use_opencl", false)
            put("show_diffusion_process", false)
            put("denoise_strength", request.strength.toDouble())
            put("image", pngBase64(crop))
            put("mask", pngBase64(solidMask))
        }
        solidMask.recycle()
        val conn = (URL("http://127.0.0.1:$port/generate").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "text/event-stream")
            connectTimeout = 10_000; readTimeout = 0
        }
        connection = conn
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode != 200) {
                val err = conn.errorStream?.bufferedReader()?.readText().orEmpty()
                throw IllegalStateException("The image engine refused the request (${conn.responseCode}). ${err.take(200)}")
            }
            var eventType = ""
            conn.inputStream.bufferedReader().useLines { lines ->
                for (raw in lines) {
                    if (cancelled) throw InterruptedException("Cancelled.")
                    val line = raw.trim()
                    if (line.startsWith("event: ")) { eventType = line.substring(7).trim(); continue }
                    if (!line.startsWith("data: ")) continue
                    val data = JSONObject(line.substring(6))
                    when (data.optString("type", eventType)) {
                        "progress" -> onStep(data.optInt("step"), data.optInt("total_steps"))
                        "error" -> throw IllegalStateException(data.optString("message", data.optString("error", "The image engine failed.")))
                        "complete" -> return rgbToBitmap(data)
                    }
                    eventType = ""
                }
            }
            throw IllegalStateException(if (cancelled) "Cancelled." else "The image engine stopped without a result.")
        } catch (e: Exception) {
            if (cancelled) throw InterruptedException("Cancelled.")
            throw e
        } finally {
            connection = null
            try { conn.disconnect() } catch (_: Exception) {}
        }
    }

    private fun rgbToBitmap(data: JSONObject): Bitmap {
        val w = data.getInt("width"); val h = data.getInt("height")
        val rgb = Base64.decode(data.getString("image"), Base64.DEFAULT)
        require(rgb.size >= w * h * 3) { "The image engine returned a damaged image." }
        val px = IntArray(w * h) { i ->
            Color.rgb(rgb[3 * i].toInt() and 0xff, rgb[3 * i + 1].toInt() and 0xff, rgb[3 * i + 2].toInt() and 0xff)
        }
        val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
        return if (w == SIZE && h == SIZE) bmp else Bitmap.createScaledBitmap(bmp, SIZE, SIZE, true).also { bmp.recycle() }
    }
}
