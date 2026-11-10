package ai.offgridmobile.photoeditor

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID
import kotlin.math.max

/** Result of copying a photo into an edit session. Sizes are after EXIF rotation. */
data class ImportedPhoto(
    val sessionId: String,
    val originalPath: String,
    val previewPath: String,
    val width: Int,
    val height: Int,
    val previewWidth: Int,
    val previewHeight: Int,
    val mimeType: String,
    val hasLocation: Boolean,
    val fileSizeBytes: Long,
    val displayName: String,
)

/**
 * Copies a photo into app storage byte-for-byte (so the original file and its EXIF are
 * never touched) and writes a downscaled, upright preview for the canvas.
 *
 * A 48 MP photo is never decoded at full size here: the preview is decoded with
 * inSampleSize (8000x6000 decodes at 4000x3000), so peak memory stays around 50 MB.
 */
object PhotoImporter {
    private const val TAG = "PhotoImporter"
    const val PREVIEW_MAX_SIDE = 2048

    fun sessionsRoot(context: Context): File = File(context.filesDir, "photo_editor/sessions")

    fun incomingRoot(context: Context): File = File(context.filesDir, "photo_editor/incoming")

    /**
     * Android hides GPS data from photos unless the app holds ACCESS_MEDIA_LOCATION and asks
     * for the original. That only works on MediaStore URIs, so a document URI is converted.
     */
    fun openOriginal(context: Context, source: String): InputStream {
        if (!source.startsWith("content://")) {
            return File(source.removePrefix("file://")).inputStream()
        }
        val uri = Uri.parse(source)
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION) == PackageManager.PERMISSION_GRANTED
        ) {
            try {
                val mediaUri = if (DocumentsContract.isDocumentUri(context, uri)) {
                    MediaStore.getMediaUri(context, uri)
                } else uri
                if (mediaUri != null && mediaUri.authority == MediaStore.AUTHORITY) {
                    resolver.openInputStream(MediaStore.setRequireOriginal(mediaUri))?.let { return it }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Original (with location) not available, using the shared copy: ${e.message}")
            }
        }
        return resolver.openInputStream(uri) ?: throw IllegalStateException("Could not open the photo.")
    }

    fun displayNameOf(context: Context, source: String): String {
        if (!source.startsWith("content://")) return File(source).nameWithoutExtension
        return try {
            context.contentResolver.query(Uri.parse(source), arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0)?.substringBeforeLast('.') else null }
                ?: "photo"
        } catch (_: Exception) { "photo" }
    }

    /** Copies [source] (content URI or file path) to [dest]. Returns bytes written. */
    fun copyTo(context: Context, source: String, dest: File): Long {
        dest.parentFile?.mkdirs()
        openOriginal(context, source).use { input ->
            FileOutputStream(dest).use { output -> return input.copyTo(output, 1 shl 16) }
        }
    }

    fun import(context: Context, source: String): ImportedPhoto {
        val sessionId = UUID.randomUUID().toString()
        val dir = File(sessionsRoot(context), sessionId).apply { mkdirs() }
        val displayName = displayNameOf(context, source)
        val tmp = File(dir, "original.tmp")
        val size = copyTo(context, source, tmp)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(tmp.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            dir.deleteRecursively()
            throw IllegalArgumentException("This file is not a photo the editor can open.")
        }
        val mime = bounds.outMimeType ?: "image/jpeg"
        val original = File(dir, "original.${extensionFor(mime)}")
        tmp.renameTo(original)

        val exif = readExif(original)
        val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            ?: ExifInterface.ORIENTATION_NORMAL
        val swaps = orientation in setOf(
            ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE,
        )
        val width = if (swaps) bounds.outHeight else bounds.outWidth
        val height = if (swaps) bounds.outWidth else bounds.outHeight
        @Suppress("DEPRECATION")
        val hasLocation = exif?.getLatLong(FloatArray(2)) == true

        val preview = File(dir, "preview.jpg")
        val (pw, ph) = writePreview(original, bounds.outWidth, bounds.outHeight, orientation, preview)

        return ImportedPhoto(
            sessionId, original.absolutePath, preview.absolutePath, width, height, pw, ph,
            mime, hasLocation, size, displayName,
        )
    }

    private fun readExif(file: File): ExifInterface? = try { ExifInterface(file.absolutePath) } catch (_: Exception) { null }

    fun extensionFor(mime: String): String = when (mime.lowercase()) {
        "image/png" -> "png"
        "image/webp" -> "webp"
        "image/heic", "image/heif" -> "heic"
        else -> "jpg"
    }

    /** Smallest power-of-two sample that keeps the longest side at or under 2x [maxSide]. */
    fun sampleSizeFor(width: Int, height: Int, maxSide: Int): Int {
        var sample = 1
        while (max(width, height) / (sample * 2) >= maxSide) sample *= 2
        return sample
    }

    private fun writePreview(original: File, rawW: Int, rawH: Int, orientation: Int, out: File): Pair<Int, Int> {
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSizeFor(rawW, rawH, PREVIEW_MAX_SIDE) }
        val decoded = BitmapFactory.decodeFile(original.absolutePath, opts)
            ?: throw IllegalStateException("Could not decode the photo.")
        val scale = minOf(1f, PREVIEW_MAX_SIDE.toFloat() / max(decoded.width, decoded.height))
        val matrix = Matrix().apply {
            postScale(scale, scale)
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(270f); postScale(-1f, 1f) }
            }
        }
        val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (upright !== decoded) decoded.recycle()
        FileOutputStream(out).use { upright.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        val size = upright.width to upright.height
        upright.recycle()
        return size
    }
}
