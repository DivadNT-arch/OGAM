package ai.offgridmobile.photoeditor

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** A model file the editor downloads once and then uses offline. */
data class EditModel(
    val id: String,
    val name: String,
    val license: String,
    val fileName: String,
    /** Pinned to a commit so the file can't change under us; checked against [sha256]. */
    val url: String,
    val sha256: String,
    val sizeBytes: Long,
)

object EditModels {
    val LAMA = EditModel(
        id = "lama",
        name = "LaMa inpainting (Remove)",
        license = "Apache-2.0",
        fileName = "lama_fp32.onnx",
        url = "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx",
        sha256 = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
        sizeBytes = 208_044_816L,
    )

    val ALL = listOf(LAMA)

    fun byId(id: String): EditModel = ALL.firstOrNull { it.id == id } ?: throw IllegalArgumentException("Unknown model $id")

    fun dir(context: Context): File = File(context.filesDir, "photo_editor/models").apply { mkdirs() }

    fun file(context: Context, model: EditModel): File = File(dir(context), model.fileName)

    fun isInstalled(context: Context, model: EditModel): Boolean = file(context, model).length() == model.sizeBytes

    private val cancelled = ConcurrentHashMap<String, AtomicBoolean>()

    private val http by lazy {
        OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    }

    fun cancel(id: String) { cancelled[id]?.set(true) }

    /**
     * Downloads to a .part file (resuming if one exists), checks the SHA-256, then renames.
     * [onProgress] gets (bytesDone, bytesTotal) at most every 250 ms.
     */
    fun download(context: Context, model: EditModel, onProgress: (Long, Long) -> Unit) {
        val flag = AtomicBoolean(false).also { cancelled[model.id] = it }
        val target = file(context, model)
        val part = File(target.path + ".part")
        try {
            var done = part.length().coerceAtMost(model.sizeBytes)
            if (done < model.sizeBytes) {
                val request = Request.Builder().url(model.url).apply { if (done > 0) header("Range", "bytes=$done-") }.build()
                http.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) throw IllegalStateException("Download failed (HTTP ${response.code}).")
                    if (done > 0 && response.code != 206) { done = 0; part.delete() } // server ignored the range
                    val body = response.body ?: throw IllegalStateException("Download failed (empty response).")
                    FileOutputStream(part, done > 0).use { out ->
                        body.byteStream().use { input ->
                            val buf = ByteArray(1 shl 16)
                            var last = 0L
                            while (true) {
                                if (flag.get()) throw InterruptedException("Download cancelled.")
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                val now = System.currentTimeMillis()
                                if (now - last > 250) { onProgress(done, model.sizeBytes); last = now }
                            }
                        }
                    }
                }
            }
            onProgress(done, model.sizeBytes)
            if (sha256(part) != model.sha256) {
                part.delete()
                throw IllegalStateException("The downloaded file is damaged. Please try again.")
            }
            if (!part.renameTo(target)) throw IllegalStateException("Could not store the model.")
        } finally {
            cancelled.remove(model.id)
        }
    }

    fun delete(context: Context, model: EditModel): Boolean {
        File(file(context, model).path + ".part").delete()
        return file(context, model).delete()
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(1 shl 16)
            while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
