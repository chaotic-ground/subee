package io.github.lens0021.subee

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Outcome of a worker poll: posts newly added this run, and the total queued. */
data class PollResult(val added: Int, val pendingTotal: Int)

/**
 * State shared between the WebView app and the background worker.
 *
 * The web side pushes auth + per-account cursors (saveState). The worker
 * advances cursors and accumulates fetched posts (recordPollResults) until
 * the web side imports them on next launch (consumeResults).
 */
class SyncStore(context: Context) {
    private val prefs = context.getSharedPreferences("subee-sync", Context.MODE_PRIVATE)

    var backgroundSyncEnabled: Boolean
        get() = prefs.getBoolean(KEY_ENABLED, false)
        set(value) {
            prefs.edit().putBoolean(KEY_ENABLED, value).apply()
        }

    /** Epoch millis before which the worker must not poll (instance backoff). */
    var rateLimitedUntil: Long
        get() = prefs.getLong(KEY_RATE_LIMITED_UNTIL, 0L)
        set(value) {
            prefs.edit().putLong(KEY_RATE_LIMITED_UNTIL, value).apply()
        }

    fun saveState(json: String) {
        synchronized(LOCK) {
            JSONObject(json) // validate before storing
            prefs.edit().putString(KEY_STATE, json).apply()
        }
    }

    fun loadState(): JSONObject? =
        synchronized(LOCK) {
            val raw = prefs.getString(KEY_STATE, null) ?: return null
            runCatching { JSONObject(raw) }.getOrNull()
        }

    fun clear() {
        synchronized(LOCK) {
            prefs.edit().clear().apply()
        }
    }

    /**
     * Advance cursors in the saved state (so the next worker run does not
     * refetch), queue the cursor updates and posts for the web side, and
     * report posts added this run plus the total now pending (so callers
     * don't have to re-read and re-parse the queue).
     */
    fun recordPollResults(
        cursorUpdates: Map<String, JSONObject>,
        posts: List<JSONObject>,
    ): PollResult =
        synchronized(LOCK) {
            val state = loadState() ?: return PollResult(0, 0)
            val cursors = state.optJSONArray("cursors") ?: JSONArray()
            for (i in 0 until cursors.length()) {
                val cursor = cursors.optJSONObject(i) ?: continue
                val update = cursorUpdates[cursor.optString("handle")] ?: continue
                cursor.put("sinceId", update.getString("sinceId"))
                cursor.put("lastPolledAt", update.getLong("lastPolledAt"))
            }

            val pendingCursors = JSONObject(prefs.getString(KEY_PENDING_CURSORS, "{}") ?: "{}")
            for ((handle, update) in cursorUpdates) {
                pendingCursors.put(handle, update)
            }

            val pendingPosts = JSONArray(prefs.getString(KEY_PENDING_POSTS, "[]") ?: "[]")
            val seen = HashSet<String>()
            val merged = ArrayList<JSONObject>()
            for (i in 0 until pendingPosts.length()) {
                val post = pendingPosts.optJSONObject(i) ?: continue
                if (seen.add(post.optString("id"))) merged.add(post)
            }
            var added = 0
            for (post in posts) {
                if (seen.add(post.optString("id"))) {
                    merged.add(post)
                    added++
                }
            }
            merged.sortByDescending { it.optString("created_at") }
            val capped = merged.take(MAX_PENDING_POSTS)

            prefs.edit()
                .putString(KEY_STATE, state.toString())
                .putString(KEY_PENDING_CURSORS, pendingCursors.toString())
                .putString(KEY_PENDING_POSTS, JSONArray(capped).toString())
                .apply()
            PollResult(added, capped.size)
        }

    /** Return pending results as JSON for the web side and clear them. */
    fun consumeResults(): String =
        synchronized(LOCK) {
            val posts = prefs.getString(KEY_PENDING_POSTS, "[]") ?: "[]"
            val cursorsObj = JSONObject(prefs.getString(KEY_PENDING_CURSORS, "{}") ?: "{}")
            val cursorsArr = JSONArray()
            for (handle in cursorsObj.keys()) {
                val update = cursorsObj.getJSONObject(handle)
                update.put("handle", handle)
                cursorsArr.put(update)
            }
            prefs.edit().remove(KEY_PENDING_POSTS).remove(KEY_PENDING_CURSORS).apply()
            JSONObject().put("posts", JSONArray(posts)).put("cursors", cursorsArr).toString()
        }

    companion object {
        private val LOCK = Any()
        private const val KEY_STATE = "state"
        private const val KEY_PENDING_POSTS = "pendingPosts"
        private const val KEY_PENDING_CURSORS = "pendingCursors"
        private const val KEY_ENABLED = "backgroundSyncEnabled"
        private const val KEY_RATE_LIMITED_UNTIL = "rateLimitedUntil"
        private const val MAX_PENDING_POSTS = 200
    }
}
