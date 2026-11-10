package ai.offgridmobile.photoeditor

import android.content.Context

/**
 * Holds the photo that arrived through "Edit with Off Grid" until JS picks it up.
 * Kept in SharedPreferences so it survives the app process starting from cold.
 */
object IncomingShare {
    private const val PREFS = "photo_editor"
    private const val KEY = "pending_share_path"

    fun put(context: Context, path: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, path).apply()
    }

    fun take(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val path = prefs.getString(KEY, null)
        if (path != null) prefs.edit().remove(KEY).apply()
        return path
    }
}
