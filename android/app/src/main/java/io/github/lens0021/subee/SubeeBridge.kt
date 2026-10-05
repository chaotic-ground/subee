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
            // A stale backoff from before the toggle shouldn't make the first run
            // after re-enabling skip itself.
            store.rateLimitedUntil = 0L
            FeedSyncScheduler.schedule(activity.applicationContext)
            activity.runOnUiThread { activity.ensureNotificationPermission() }
        } else {
            FeedSyncScheduler.cancel(activity.applicationContext)
        }
    }

    /** The web app is polling in the foreground; see MainActivity.onStop. */
    @JavascriptInterface
    fun setForegroundSyncActive(active: Boolean) {
        activity.foregroundSyncActive = active
    }

    @JavascriptInterface
    fun getBackgroundSync(): Boolean = store.backgroundSyncEnabled

    @JavascriptInterface
    fun consumeSyncResults(): String {
        // The user is now in the app viewing posts; clear the pending-posts
        // notification so it reflects only unseen content.
        Notifications.cancel(activity.applicationContext)
        return store.consumeResults()
    }
}
