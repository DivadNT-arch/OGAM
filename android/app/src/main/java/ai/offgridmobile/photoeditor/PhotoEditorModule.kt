package ai.offgridmobile.photoeditor

import android.app.Activity
import android.content.Intent
import android.net.Uri
import ai.offgridmobile.SafePromise
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

/**
 * Native side of the photo editor (Android). JS contract: src/photoEditor/native/photoEditorNative.ts.
 * All file work runs on one background thread so the UI never waits on a 48 MP copy.
 */
class PhotoEditorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "PhotoEditorModule"
        const val EVENT_SHARE = "PhotoEditorShareReceived"
        private const val PICK_REQUEST = 42_017
        private var active: WeakReference<PhotoEditorModule>? = null

        /** Called by [EditShareActivity] when a photo arrives while the app is running. */
        fun notifyShareReceived() {
            active?.get()?.emit(EVENT_SHARE)
        }
    }

    private val io = Executors.newSingleThreadExecutor()
    private var pickPromise: SafePromise? = null

    init {
        reactContext.addActivityEventListener(this)
        active = WeakReference(this)
    }

    override fun getName(): String = NAME

    private fun emit(event: String) {
        if (!reactApplicationContext.hasActiveReactInstance()) return
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, null)
    }

    @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}
    @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

    /** Opens the system file picker for images. Resolves with a content URI, or null if cancelled. */
    @ReactMethod
    fun pickPhoto(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
            ?: return promise.reject("NO_ACTIVITY", "The app is not in the foreground.")
        pickPromise?.resolve(null)
        pickPromise = SafePromise(promise, NAME)
        // ACTION_OPEN_DOCUMENT (not the photo picker): the photo picker always strips GPS,
        // this route can return the original with location (see PhotoImporter.openOriginal).
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
        }
        activity.startActivityForResult(intent, PICK_REQUEST)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_REQUEST) return
        val promise = pickPromise ?: return
        pickPromise = null
        promise.resolve(if (resultCode == Activity.RESULT_OK) data?.data?.toString() else null)
    }

    override fun onNewIntent(intent: Intent) {}

    @ReactMethod
    fun importPhoto(source: String, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        io.execute {
            val started = System.currentTimeMillis()
            try {
                val p = PhotoImporter.import(reactApplicationContext, source)
                if (source.startsWith(PhotoImporter.incomingRoot(reactApplicationContext).absolutePath)) File(source).delete()
                safe.resolve(Arguments.createMap().apply {
                    putString("sessionId", p.sessionId)
                    putString("originalPath", p.originalPath)
                    putString("previewPath", p.previewPath)
                    putInt("width", p.width)
                    putInt("height", p.height)
                    putInt("previewWidth", p.previewWidth)
                    putInt("previewHeight", p.previewHeight)
                    putString("mimeType", p.mimeType)
                    putBoolean("hasLocation", p.hasLocation)
                    putDouble("fileSizeBytes", p.fileSizeBytes.toDouble())
                    putString("displayName", p.displayName)
                    putDouble("durationMs", (System.currentTimeMillis() - started).toDouble())
                })
            } catch (e: OutOfMemoryError) {
                safe.reject("IMPORT_MEMORY", "Not enough free memory to open this photo. Close other apps and try again.")
            } catch (e: Exception) {
                safe.reject("IMPORT_FAILED", e.message ?: "Could not open the photo.", e)
            }
        }
    }

    @ReactMethod
    fun saveAsNew(params: ReadableMap, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        io.execute {
            val started = System.currentTimeMillis()
            try {
                val saved = PhotoSaver.save(
                    reactApplicationContext,
                    resultPath = params.getString("resultPath")!!,
                    metadataSourcePath = params.getString("originalPath")!!,
                    keepMetadata = !params.hasKey("keepMetadata") || params.getBoolean("keepMetadata"),
                    baseName = if (params.hasKey("baseName")) params.getString("baseName") ?: "photo" else "photo",
                )
                safe.resolve(Arguments.createMap().apply {
                    putString("uri", saved.uri)
                    putString("displayName", saved.displayName)
                    putString("album", saved.relativePath)
                    putDouble("durationMs", (System.currentTimeMillis() - started).toDouble())
                })
            } catch (e: Exception) {
                safe.reject("SAVE_FAILED", e.message ?: "Could not save the photo.", e)
            }
        }
    }

    /** Opens the share sheet for a photo already saved to the gallery (content URI). */
    @ReactMethod
    fun sharePhoto(uri: String, promise: Promise) {
        try {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/*"
                putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            (reactApplicationContext.currentActivity ?: reactApplicationContext).startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SHARE_FAILED", e.message ?: "Could not open the share sheet.", e)
        }
    }

    /** Returns the file path of a photo received through "Edit with Off Grid", once. */
    @ReactMethod
    fun takePendingShare(promise: Promise) {
        promise.resolve(IncomingShare.take(reactApplicationContext))
    }

    @ReactMethod
    fun deleteSession(sessionId: String, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        io.execute {
            val root = PhotoImporter.sessionsRoot(reactApplicationContext)
            val dir = File(root, sessionId)
            // Only ever delete inside our own sessions folder.
            val ok = dir.canonicalPath.startsWith(root.canonicalPath + File.separator) && dir.deleteRecursively()
            safe.resolve(ok)
        }
    }

    override fun invalidate() {
        io.shutdown()
        super.invalidate()
    }
}
