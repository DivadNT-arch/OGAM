package ai.offgridmobile.photoeditor

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import ai.offgridmobile.MainActivity
import java.io.File

/**
 * Receives "Edit with Off Grid" from the share sheet or a gallery's Edit/Open with menu.
 * The read permission for a shared photo belongs to this activity only, so the photo is
 * copied into app storage here before handing over to the main app.
 */
class EditShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uri = sharedUri(intent)
        if (uri == null) { finish(); return }
        Thread {
            val path = try {
                val dest = File(PhotoImporter.incomingRoot(this), "${System.currentTimeMillis()}.img")
                PhotoImporter.copyTo(this, uri.toString(), dest)
                dest.absolutePath
            } catch (e: Exception) {
                Log.e("EditShareActivity", "Could not receive the shared photo", e)
                null
            }
            runOnUiThread {
                if (path == null) {
                    Toast.makeText(this, "Off Grid could not open that photo.", Toast.LENGTH_LONG).show()
                } else {
                    IncomingShare.put(this, path)
                    PhotoEditorModule.notifyShareReceived()
                    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                finish()
            }
        }.start()
    }

    @Suppress("DEPRECATION")
    private fun sharedUri(intent: Intent?): Uri? {
        if (intent == null) return null
        if (intent.action == Intent.ACTION_SEND) {
            return if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        return intent.data
    }
}
