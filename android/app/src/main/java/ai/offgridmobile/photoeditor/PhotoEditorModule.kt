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
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
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
        const val EVENT_MODEL_PROGRESS = "PhotoEditorModelProgress"
        const val EVENT_EDIT_PROGRESS = "PhotoEditorEditProgress"
        private const val PICK_REQUEST = 42_017
        private var active: WeakReference<PhotoEditorModule>? = null
        /** Crops with a longer side than this use the 1024 model if it is downloaded. */
        private const val LARGE_AREA_PX = 900

        /** Called by [EditShareActivity] when a photo arrives while the app is running. */
        fun notifyShareReceived() {
            active?.get()?.emit(EVENT_SHARE)
        }
    }

    private val io = Executors.newSingleThreadExecutor()
    /** Edits run on their own thread so a long model run never blocks opening or saving. */
    private val edits = Executors.newSingleThreadExecutor()
    private val downloads = Executors.newSingleThreadExecutor()
    private var pickPromise: SafePromise? = null
    /** Loaded LaMa engines by input size. Only one is kept at a time to bound memory. */
    @Volatile private var lama: LamaEngine? = null
    @Volatile private var editCancelled = false
    @Volatile private var fillClient: LocalDreamFillClient? = null

    init {
        reactContext.addActivityEventListener(this)
        active = WeakReference(this)
    }

    override fun getName(): String = NAME

    private fun emit(event: String, payload: WritableMap? = null) {
        if (!reactApplicationContext.hasActiveReactInstance()) return
        reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
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

    // ---- Editing models ---------------------------------------------------------------

    private fun modelInfo(m: EditModel): WritableMap = Arguments.createMap().apply {
        putString("id", m.id)
        putString("name", m.name)
        putString("license", m.license)
        putDouble("sizeBytes", m.sizeBytes.toDouble())
        putInt("inputSize", m.inputSize)
        putBoolean("installed", EditModels.isInstalled(reactApplicationContext, m))
        val part = File(EditModels.file(reactApplicationContext, m).path + ".part")
        putDouble("partialBytes", part.length().toDouble())
    }

    @ReactMethod
    fun getEditModels(promise: Promise) {
        promise.resolve(Arguments.createArray().apply { EditModels.ALL.forEach { pushMap(modelInfo(it)) } })
    }

    @ReactMethod
    fun downloadEditModel(id: String, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        val model = try { EditModels.byId(id) } catch (e: Exception) { return safe.reject("UNKNOWN_MODEL", e.message ?: id) }
        downloads.execute {
            try {
                // Phone connections drop; each retry resumes from where the last one stopped.
                var attempt = 0
                while (true) {
                    try {
                        EditModels.download(reactApplicationContext, model) { done, total ->
                            emit(EVENT_MODEL_PROGRESS, Arguments.createMap().apply {
                                putString("id", id); putDouble("bytesDone", done.toDouble()); putDouble("bytesTotal", total.toDouble())
                            })
                        }
                        break
                    } catch (e: java.io.IOException) {
                        attempt++
                        if (attempt >= 4) throw e
                        Thread.sleep(2000L shl attempt) // 4 s, 8 s, 16 s
                    }
                }
                safe.resolve(modelInfo(model))
            } catch (e: InterruptedException) {
                safe.reject("DOWNLOAD_CANCELLED", "Download cancelled.")
            } catch (e: Exception) {
                safe.reject("DOWNLOAD_FAILED", e.message ?: "Download failed.", e)
            }
        }
    }

    @ReactMethod
    fun cancelModelDownload(id: String, promise: Promise) {
        EditModels.cancel(id)
        promise.resolve(true)
    }

    @ReactMethod
    fun deleteEditModel(id: String, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        edits.execute {
            try {
                val model = EditModels.byId(id)
                if (lama != null && model.inputSize == lama?.size) { lama?.close(); lama = null }
                EditModels.delete(reactApplicationContext, model)
                safe.resolve(modelInfo(model))
            } catch (e: Exception) {
                safe.reject("DELETE_FAILED", e.message ?: "Could not delete the model.", e)
            }
        }
    }

    // ---- Edits --------------------------------------------------------------------------

    private fun parseStrokes(array: ReadableArray): List<Stroke> = (0 until array.size()).map { i ->
        val m = array.getMap(i)!!
        val pts = m.getArray("points")!!
        Stroke(
            erase = m.getString("mode") == "erase",
            size = m.getDouble("size").toFloat(),
            points = FloatArray(pts.size()) { pts.getDouble(it).toFloat() },
        )
    }

    /** Cuts out the painted area and fills it with LaMa. Resolves with the new result file. */
    @ReactMethod
    fun applyRemove(params: ReadableMap, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        val sessionId = params.getString("sessionId")!!
        val sourcePath = params.getString("sourcePath")!!
        val originalPath = params.getString("originalPath")!!
        val outName = params.getString("outName")!!
        val strokes = parseStrokes(params.getArray("strokes")!!)
        editCancelled = false
        edits.execute {
            try {
                val ctx = reactApplicationContext
                val installed = listOf(EditModels.LAMA, EditModels.LAMA_1024).filter { EditModels.isInstalled(ctx, it) }
                if (installed.isEmpty()) {
                    return@execute safe.reject("MODEL_MISSING", "Download a Remove model first (Edit tab, Editing models).")
                }
                // Large areas go to the 1024 model when it is there (half the downscaling), small ones to 512 (faster).
                val sizeFor: (Int) -> Int = { longSide ->
                    val wantLarge = longSide > LARGE_AREA_PX
                    (installed.firstOrNull { if (wantLarge) it.inputSize == 1024 else it.inputSize == 512 } ?: installed.first()).inputSize
                }
                var loadMs = 0L
                var usedSize = 0
                val dir = File(PhotoImporter.sessionsRoot(ctx), sessionId)
                val out = EditRenderer.applyRegion(
                    ctx, sourcePath, originalPath, strokes, dir, outName, installed.maxOf { it.inputSize }, sizeFor,
                ) { crop, mask ->
                    if (editCancelled) throw InterruptedException("Cancelled.")
                    val model = installed.first { it.inputSize == crop.width }
                    val engine = lama?.takeIf { it.size == model.inputSize } ?: run {
                        lama?.close(); lama = null
                        val t = System.currentTimeMillis()
                        LamaEngine(EditModels.file(ctx, model), threads = 4, size = model.inputSize)
                            .also { lama = it; loadMs = System.currentTimeMillis() - t }
                    }
                    usedSize = model.inputSize
                    engine.inpaint(crop, mask)
                }
                if (editCancelled) { File(out.resultPath).delete(); File(out.previewPath).delete(); throw InterruptedException("Cancelled.") }
                safe.resolve(Arguments.createMap().apply {
                    putString("resultPath", out.resultPath)
                    putString("previewPath", out.previewPath)
                    putDouble("loadMs", loadMs.toDouble())
                    putInt("modelSize", usedSize)
                    putDouble("decodeMs", out.decodeMs.toDouble())
                    putDouble("maskMs", out.maskMs.toDouble())
                    putDouble("modelMs", out.modelMs.toDouble())
                    putDouble("blendMs", out.blendMs.toDouble())
                    putDouble("encodeMs", out.encodeMs.toDouble())
                    putInt("cropWidth", out.cropW)
                    putInt("cropHeight", out.cropH)
                })
            } catch (e: InterruptedException) {
                safe.reject("EDIT_CANCELLED", "Cancelled.")
            } catch (e: LowMemoryException) {
                safe.reject("LOW_MEMORY", e.message ?: "Not enough free memory.")
            } catch (e: OutOfMemoryError) {
                lama?.close(); lama = null
                safe.reject("LOW_MEMORY", "Ran out of memory during the edit. Close other apps and try again.")
            } catch (e: Exception) {
                val cancelled = editCancelled
                safe.reject(if (cancelled) "EDIT_CANCELLED" else "EDIT_FAILED", if (cancelled) "Cancelled." else (e.message ?: "The edit failed."), e)
            }
        }
    }

    @ReactMethod
    fun cancelEdit(promise: Promise) {
        editCancelled = true
        lama?.cancel()
        fillClient?.cancel()
        promise.resolve(true)
    }

    /** Fill needs the image model's VAE encoder; older or NPU-only downloads may not have it. */
    @ReactMethod
    fun checkFillModel(modelPath: String, promise: Promise) {
        io.execute { promise.resolve(LocalDreamFillClient.hasVaeEncoder(modelPath)) }
    }

    /**
     * Fill: regenerates the painted area from a prompt with the loaded Stable Diffusion model
     * (local-dream server). Makes [variations] results with different seeds; resolves with a
     * list of {resultPath, previewPath, seed}.
     */
    @ReactMethod
    fun applyFill(params: ReadableMap, promise: Promise) {
        val safe = SafePromise(promise, NAME)
        val sessionId = params.getString("sessionId")!!
        val sourcePath = params.getString("sourcePath")!!
        val originalPath = params.getString("originalPath")!!
        val outName = params.getString("outName")!!
        val strokes = parseStrokes(params.getArray("strokes")!!)
        val variations = params.getInt("variations").coerceIn(1, 4)
        val baseSeed = params.getDouble("seed").toLong()
        val port = params.getInt("port")
        val request = FillRequest(
            prompt = params.getString("prompt") ?: "",
            negativePrompt = params.getString("negativePrompt") ?: "",
            strength = params.getDouble("strength").toFloat().coerceIn(0.05f, 1f),
            steps = params.getInt("steps").coerceIn(4, 50),
            guidance = params.getDouble("guidance").toFloat(),
            seed = baseSeed,
        )
        editCancelled = false
        edits.execute {
            val client = LocalDreamFillClient(port).also { fillClient = it }
            try {
                if (!client.isServerUp()) {
                    return@execute safe.reject("ENGINE_NOT_READY", "The image model is not loaded. Try again.")
                }
                // LaMa is not needed while Stable Diffusion runs; free its memory.
                lama?.close(); lama = null
                val ctx = reactApplicationContext
                val dir = File(PhotoImporter.sessionsRoot(ctx), sessionId)
                val results = Arguments.createArray()
                var modelMs = 0L; var otherMs = 0L; var cropW = 0; var cropH = 0
                for (v in 0 until variations) {
                    val seed = baseSeed + v * 7919L
                    val out = EditRenderer.applyRegion(
                        ctx, sourcePath, originalPath, strokes, dir, "${outName}_v$v",
                        // The SD server runs in its own process; keep a modest headroom for this one.
                        maxInputSize = LocalDreamFillClient.SIZE, sizeFor = { LocalDreamFillClient.SIZE },
                    ) { crop, mask ->
                        client.inpaint(crop, mask, request.copy(seed = seed)) { step, total ->
                            emit(EVENT_EDIT_PROGRESS, Arguments.createMap().apply {
                                putInt("step", step); putInt("totalSteps", total)
                                putInt("variation", v + 1); putInt("variations", variations)
                            })
                        }
                    }
                    if (editCancelled) {
                        File(out.resultPath).delete(); File(out.previewPath).delete()
                        throw InterruptedException("Cancelled.")
                    }
                    modelMs += out.modelMs; otherMs += out.decodeMs + out.blendMs + out.encodeMs
                    cropW = out.cropW; cropH = out.cropH
                    results.pushMap(Arguments.createMap().apply {
                        putString("resultPath", out.resultPath)
                        putString("previewPath", out.previewPath)
                        putDouble("seed", seed.toDouble())
                    })
                }
                safe.resolve(Arguments.createMap().apply {
                    putArray("results", results)
                    putDouble("modelMs", modelMs.toDouble())
                    putDouble("otherMs", otherMs.toDouble())
                    putInt("cropWidth", cropW); putInt("cropHeight", cropH)
                })
            } catch (e: InterruptedException) {
                safe.reject("EDIT_CANCELLED", "Cancelled.")
            } catch (e: LowMemoryException) {
                safe.reject("LOW_MEMORY", e.message ?: "Not enough free memory.")
            } catch (e: OutOfMemoryError) {
                safe.reject("LOW_MEMORY", "Ran out of memory during the edit. Close other apps and try again.")
            } catch (e: Exception) {
                if (editCancelled) safe.reject("EDIT_CANCELLED", "Cancelled.")
                else safe.reject("EDIT_FAILED", e.message ?: "Fill failed.", e)
            } finally {
                fillClient = null
            }
        }
    }

    /** Frees the editing model's memory (called before loading something big elsewhere). */
    @ReactMethod
    fun releaseEditEngines(promise: Promise) {
        edits.execute { lama?.close(); lama = null; promise.resolve(true) }
    }

    /** Deletes result files inside a session folder (dropped history steps). */
    @ReactMethod
    fun deleteSessionFiles(paths: ReadableArray, promise: Promise) {
        val root = PhotoImporter.sessionsRoot(reactApplicationContext).canonicalPath + File.separator
        io.execute {
            var n = 0
            for (i in 0 until paths.size()) {
                val f = File(paths.getString(i) ?: continue)
                if (f.canonicalPath.startsWith(root) && f.delete()) n++
            }
            promise.resolve(n)
        }
    }

    override fun invalidate() {
        io.shutdown()
        downloads.shutdown()
        edits.execute { lama?.close(); lama = null }
        edits.shutdown()
        super.invalidate()
    }
}
