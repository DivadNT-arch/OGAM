package ai.offgridmobile.photoeditor

import android.content.ContentValues
import android.content.Context
import android.media.ExifInterface
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class SavedPhoto(val uri: String, val displayName: String, val relativePath: String)

/**
 * Writes an edit result to the gallery as a NEW file in Pictures/Off Grid Edits.
 * It never opens the source photo for writing, so the original can't be overwritten.
 */
object PhotoSaver {
    const val ALBUM = "Off Grid Edits"

    /** Tags carried over from the original when the edited pixels come from another file. */
    private val CARRIED_TAGS = listOf(
        ExifInterface.TAG_DATETIME, ExifInterface.TAG_DATETIME_ORIGINAL, ExifInterface.TAG_DATETIME_DIGITIZED,
        ExifInterface.TAG_OFFSET_TIME, ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
        ExifInterface.TAG_SUBSEC_TIME_ORIGINAL,
        ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF,
        ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
        ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP,
        ExifInterface.TAG_MAKE, ExifInterface.TAG_MODEL, ExifInterface.TAG_ORIENTATION,
    )

    /** Tags removed when the user turns "keep date and location" off. */
    private val PRIVATE_TAGS = listOf(
        ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF,
        ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
        ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
        ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP,
        ExifInterface.TAG_GPS_PROCESSING_METHOD,
        ExifInterface.TAG_DATETIME, ExifInterface.TAG_DATETIME_ORIGINAL, ExifInterface.TAG_DATETIME_DIGITIZED,
        ExifInterface.TAG_OFFSET_TIME, ExifInterface.TAG_OFFSET_TIME_ORIGINAL, ExifInterface.TAG_OFFSET_TIME_DIGITIZED,
        ExifInterface.TAG_SUBSEC_TIME, ExifInterface.TAG_SUBSEC_TIME_ORIGINAL, ExifInterface.TAG_SUBSEC_TIME_DIGITIZED,
    )

    /** Copies date, location, camera and orientation tags from [from] onto the JPEG [to]. */
    fun copyExif(from: File, to: File) {
        val source = try { ExifInterface(from.absolutePath) } catch (_: Exception) { null } ?: return
        val target = ExifInterface(to.absolutePath)
        CARRIED_TAGS.forEach { tag -> source.getAttribute(tag)?.let { target.setAttribute(tag, it) } }
        target.saveAttributes()
    }

    fun newDisplayName(baseName: String, extension: String, now: Date = Date()): String {
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(now)
        val safe = baseName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(60).ifEmpty { "photo" }
        return "${safe}_edit_$stamp.$extension"
    }

    private fun mimeFor(extension: String) = when (extension) {
        "png" -> "image/png"
        "webp" -> "image/webp"
        "heic" -> "image/heic"
        else -> "image/jpeg"
    }

    /**
     * @param resultPath the pixels to save (in Phase 1 this is the untouched original copy).
     * @param metadataSourcePath the session's original, whose date/location are carried over.
     */
    fun save(
        context: Context, resultPath: String, metadataSourcePath: String,
        keepMetadata: Boolean, baseName: String,
    ): SavedPhoto {
        val result = File(resultPath)
        val extension = result.extension.lowercase().ifEmpty { "jpg" }
        val staged = File(context.cacheDir, "photo_editor_save.$extension")
        result.copyTo(staged, overwrite = true)
        try {
            prepareMetadata(staged, File(metadataSourcePath), keepMetadata)
            val name = newDisplayName(baseName, extension)
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) insertMediaStore(context, staged, name, extension)
            else writeLegacy(context, staged, name)
        } finally {
            staged.delete()
        }
    }

    private fun prepareMetadata(staged: File, original: File, keepMetadata: Boolean) {
        val writable = staged.extension.lowercase() in setOf("jpg", "jpeg", "png", "webp")
        val sameFile = staged.length() == original.length() && keepMetadata
        if (sameFile) return // byte copy of the original: EXIF is already identical
        if (!writable) {
            if (!keepMetadata) throw IllegalStateException("Removing date and location from ${staged.extension.uppercase()} photos is not supported yet.")
            return
        }
        val exif = ExifInterface(staged.absolutePath)
        if (keepMetadata) {
            val source = try { ExifInterface(original.absolutePath) } catch (_: Exception) { null } ?: return
            CARRIED_TAGS.forEach { tag -> source.getAttribute(tag)?.let { exif.setAttribute(tag, it) } }
        } else {
            PRIVATE_TAGS.forEach { exif.setAttribute(it, null) }
        }
        exif.saveAttributes()
    }

    private fun insertMediaStore(context: Context, file: File, name: String, extension: String): SavedPhoto {
        val relative = "${Environment.DIRECTORY_PICTURES}/$ALBUM"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(extension))
            put(MediaStore.MediaColumns.RELATIVE_PATH, relative)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
            ?: throw IllegalStateException("The gallery refused the new photo.")
        try {
            resolver.openOutputStream(uri, "w")?.use { out -> file.inputStream().use { it.copyTo(out, 1 shl 16) } }
                ?: throw IllegalStateException("Could not write the new photo.")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
        return SavedPhoto(uri.toString(), name, relative)
    }

    @Suppress("DEPRECATION")
    private fun writeLegacy(context: Context, file: File, name: String): SavedPhoto {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM).apply { mkdirs() }
        val dest = File(dir, name)
        file.copyTo(dest, overwrite = false)
        MediaScannerConnection.scanFile(context, arrayOf(dest.absolutePath), null, null)
        return SavedPhoto(Uri.fromFile(dest).toString(), name, "Pictures/$ALBUM")
    }
}
