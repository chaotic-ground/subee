package io.github.lens0021.subee

import android.webkit.JavascriptInterface

/**
 * Exposed to the WebView as `window.SubeeAndroid`.
 * Counterpart of src/native/android.ts in the web app.
 */
class SubeeBridge(private val activity: MainActivity) {
    private val store = SyncStore(activity.applicationContext)

    @JavascriptInterface
    fun updateSyncState(json: String) {
        runCatching { store.saveState(json) }
    }

    @JavascriptInterface
    fun clearSyncState() {
        store.clear()
        FeedSyncScheduler.cancel(activity.applicationContext)
    }

    @JavascriptInterface
    fun setBackgroundSync(enabled: Boolean) {
        store.backgroundSyncEnabled = enabled
        if (enabled) {
            FeedSyncScheduler.schedule(activity.applicationContext)
            activity.runOnUiThread { activity.ensureNotificationPermission() }
        } else {
            FeedSyncScheduler.cancel(activity.applicationContext)
        }
    }

    @JavascriptInterface
    fun getBackgroundSync(): Boolean = store.backgroundSyncEnabled

    @JavascriptInterface
    fun consumeSyncResults(): String = store.consumeResults()
}
