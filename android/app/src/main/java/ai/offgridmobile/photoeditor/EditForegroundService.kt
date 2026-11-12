package ai.offgridmobile.photoeditor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps a running edit at full speed. Without it, Android moves the app (and the image engine
 * process it started) to slow, throttled cores as soon as the screen turns off or another app
 * opens: a 2-minute Fill took about 17 minutes in testing. The notification shows progress.
 */
class EditForegroundService : Service() {
    companion object {
        private const val CHANNEL = "photo_editor_edits"
        private const val ID = 42_018
        private const val EXTRA_TEXT = "text"

        fun start(context: Context, text: String) {
            val intent = Intent(context, EditForegroundService::class.java).putExtra(EXTRA_TEXT, text)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
                else context.startService(intent)
            } catch (_: Exception) {
                // Not allowed right now (e.g. started from the background): the edit still runs, just unprotected.
            }
        }

        fun update(context: Context, text: String) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.activeNotifications.any { it.id == ID }) nm.notify(ID, build(context, text))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, EditForegroundService::class.java))
        }

        private fun build(context: Context, text: String): Notification {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (nm.getNotificationChannel(CHANNEL) == null) {
                    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Photo edits", NotificationManager.IMPORTANCE_LOW))
                }
            }
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
                android.app.PendingIntent.getActivity(context, 0, it, android.app.PendingIntent.FLAG_IMMUTABLE)
            }
            return NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_edit)
                .setContentTitle("Editing photo")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(open)
                .build()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = build(this, intent?.getStringExtra(EXTRA_TEXT) ?: "Working")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(ID, notification)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
