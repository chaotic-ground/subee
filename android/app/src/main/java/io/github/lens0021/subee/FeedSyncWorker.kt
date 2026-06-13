package io.github.lens0021.subee

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/** Thrown when the instance returns HTTP 429; carries how long to back off. */
private class RateLimitException(val retryAfterMs: Long) : Exception()

/**
 * Polls subscribed accounts for new posts while the app is closed,
 * mirroring src/sync/pollFeed.ts of the web app: one
 * GET /api/v1/accounts/{id}/statuses?since_id=... per account, all routed
 * through the user's own instance.
 */
class FeedSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result =
        withContext(Dispatchers.IO) {
            val store = SyncStore(applicationContext)
            if (!store.backgroundSyncEnabled) return@withContext Result.success()
            val state = store.loadState() ?: return@withContext Result.success()
            val accessToken = state.optString("accessToken")
            val cursors = state.optJSONArray("cursors") ?: JSONArray()
            if (accessToken.isEmpty() || cursors.length() == 0) {
                return@withContext Result.success()
            }

            // Respect a prior rate-limit backoff: if the home instance asked us
            // to wait, skip this run entirely until then (no polling, no wakelock
            // spent sleeping).
            if (System.currentTimeMillis() < store.rateLimitedUntil) {
                return@withContext Result.success()
            }

            // Poll accounts one at a time. All requests go to the user's home
            // instance, so this avoids bursts that could trip its rate limit, and
            // keeps the phone's peak network/CPU/memory low. Background timing
            // (every ~4h) makes the longer runtime irrelevant.
            val updates = HashMap<String, JSONObject>()
            val fetched = ArrayList<JSONObject>()
            for (i in 0 until cursors.length()) {
                val cursor = cursors.optJSONObject(i) ?: continue
                val handle = cursor.optString("handle")
                val sinceId = cursor.optString("sinceId")
                val accountId = cursor.optString("accountId")
                val instanceUrl = cursor.optString("instanceUrl").trimEnd('/')
                if (handle.isEmpty() || accountId.isEmpty() || instanceUrl.isEmpty()) continue
                // Accounts without a sinceId have never been loaded in-app;
                // leave them to the foreground initial fetch.
                if (sinceId.isEmpty() || sinceId == "null") continue
                try {
                    val posts = fetchStatuses(instanceUrl, accountId, sinceId, accessToken)
                    val update =
                        JSONObject()
                            .put("lastPolledAt", System.currentTimeMillis())
                            .put(
                                "sinceId",
                                if (posts.length() > 0) posts.getJSONObject(0).getString("id") else sinceId,
                            )
                    for (j in 0 until posts.length()) {
                        fetched.add(posts.getJSONObject(j))
                    }
                    updates[handle] = update
                } catch (e: RateLimitException) {
                    // The home instance is rate-limiting us. Every account hits
                    // the same instance, so stop polling the rest this run and
                    // hold off until it says we may try again.
                    store.rateLimitedUntil = System.currentTimeMillis() + e.retryAfterMs
                    break
                } catch (_: Exception) {
                    // skip this account until the next run
                }
            }

            if (updates.isNotEmpty()) {
                val result = store.recordPollResults(updates, fetched)
                if (result.added > 0) {
                    // Show the cumulative number of posts waiting to be viewed,
                    // updating the single existing notification in place.
                    Notifications.showNewPosts(applicationContext, result.pendingTotal)
                }
            }
            Result.success()
        }

    private fun fetchStatuses(
        instanceUrl: String,
        accountId: String,
        sinceId: String,
        accessToken: String,
    ): JSONArray {
        val url = URL("$instanceUrl/api/v1/accounts/$accountId/statuses?since_id=$sinceId&limit=$PAGE_SIZE")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.setRequestProperty("Authorization", "Bearer $accessToken")
        try {
            val code = conn.responseCode
            if (code == HTTP_TOO_MANY_REQUESTS) {
                throw RateLimitException(retryAfterMs(conn))
            }
            if (code != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("HTTP $code")
            }
            return JSONArray(conn.inputStream.bufferedReader().readText())
        } finally {
            conn.disconnect()
        }
    }

    /**
     * How long to back off after a 429, from `Retry-After` (delta seconds) or
     * Mastodon's `X-RateLimit-Reset` (ISO-8601), capped to a sane maximum.
     */
    private fun retryAfterMs(conn: HttpURLConnection): Long {
        conn.getHeaderField("Retry-After")?.trim()?.toLongOrNull()?.let { seconds ->
            return (seconds * 1000).coerceIn(0L, MAX_RATE_LIMIT_BACKOFF_MS)
        }
        conn.getHeaderField("X-RateLimit-Reset")?.let { reset ->
            try {
                val delta = Instant.parse(reset).toEpochMilli() - System.currentTimeMillis()
                if (delta > 0) return delta.coerceAtMost(MAX_RATE_LIMIT_BACKOFF_MS)
            } catch (_: Exception) {
                // unparseable — fall through to default
            }
        }
        return DEFAULT_RATE_LIMIT_BACKOFF_MS
    }

    companion object {
        private const val PAGE_SIZE = 20
        private const val TIMEOUT_MS = 15_000
        private const val HTTP_TOO_MANY_REQUESTS = 429
        private const val DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000L
        private const val MAX_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000L
    }
}
