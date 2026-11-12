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

/** One downloadable piece of a model file (large files are split under GitHub's 100 MB limit). */
data class ModelPart(val url: String, val sizeBytes: Long)

/** A model file the editor downloads once and then uses offline. */
data class EditModel(
    val id: String,
    val name: String,
    val license: String,
    val fileName: String,
    /** Pinned to commits so the file can't change under us; the joined file is checked against [sha256]. */
    val parts: List<ModelPart>,
    val sha256: String,
    /** Model input size in pixels (square). */
    val inputSize: Int,
) {
    val sizeBytes: Long get() = parts.sumOf { it.sizeBytes }
}

object EditModels {
    val LAMA = EditModel(
        id = "lama",
        name = "LaMa 512 (Remove, fast)",
        license = "Apache-2.0",
        fileName = "lama_fp32.onnx",
        parts = listOf(ModelPart(
            "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx",
            208_044_816L,
        )),
        sha256 = "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
        inputSize = 512,
    )

    /** Same big-lama weights exported at 1024 (see the editing-models branch README). Sharper on large areas. */
    private const val LAMA_1024_BASE =
        "https://raw.githubusercontent.com/DivadNT-arch/OGAM/e22f7f3e90f820708b66d2bef3e1e97eaae5b852/lama1024/lama_1024_fp32.onnx.part"
    val LAMA_1024 = EditModel(
        id = "lama1024",
        name = "LaMa 1024 (Remove, large areas)",
        license = "Apache-2.0",
        fileName = "lama_1024_fp32.onnx",
        parts = listOf(
            ModelPart("${LAMA_1024_BASE}0", 70_000_000L),
            ModelPart("${LAMA_1024_BASE}1", 70_000_000L),
            ModelPart("${LAMA_1024_BASE}2", 67_594_478L),
        ),
        sha256 = "923d45aa2dcd98d43b98597c88118dc6bb8a0bccec0b63a6dd39df45b1c9fd4c",
        inputSize = 1024,
    )

    /** Real-ESRGAN general x4v3 (BSD-3), exported to ONNX; see the editing-models branch README. */
    val ESRGAN = EditModel(
        id = "esrgan",
        name = "Real-ESRGAN (Upscale)",
        license = "BSD-3-Clause",
        fileName = "realesr_general_x4v3.onnx",
        parts = listOf(ModelPart(
            "https://raw.githubusercontent.com/DivadNT-arch/OGAM/f4c23b5ddca7d308eab36fef4fa2d64e6f36f84c/esrgan/realesr_general_x4v3.onnx",
            4_866_396L,
        )),
        sha256 = "3439a9e4cd26c4cdfff28f82f00411a7a4f06e7f72a1efdc664479f1e2bf0690",
        inputSize = 0,
    )

    val ALL = listOf(LAMA, LAMA_1024, ESRGAN)

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
        val total = model.sizeBytes
        try {
            var done = part.length().coerceAtMost(total)
            var partStart = 0L
            for (piece in model.parts) {
                val partEnd = partStart + piece.sizeBytes
                if (done < partEnd) {
                    val offset = done - partStart
                    val request = Request.Builder().url(piece.url).apply { if (offset > 0) header("Range", "bytes=$offset-") }.build()
                    http.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) throw IllegalStateException("Download failed (HTTP ${response.code}).")
                        if (offset > 0 && response.code != 206) {
                            // The server ignored the range: rewind this piece.
                            java.io.RandomAccessFile(part, "rw").use { it.setLength(partStart) }
                            done = partStart
                        }
                        val body = response.body ?: throw IllegalStateException("Download failed (empty response).")
                        FileOutputStream(part, true).use { out ->
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
                                    if (now - last > 250) { onProgress(done, total); last = now }
                                }
                            }
                        }
                    }
                    if (done != partEnd) throw IllegalStateException("Download was cut off. Tap Resume to continue.")
                }
                partStart = partEnd
            }
            onProgress(done, total)
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
