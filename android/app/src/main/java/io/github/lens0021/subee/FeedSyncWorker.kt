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
 * GET /api/v1/accounts/{id}/statuses?min_id=... per account, paged forward
 * until caught up, all routed through the user's own instance.
 */
class FeedSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result =
        withContext(Dispatchers.IO) {
            val store = SyncStore(applicationContext)
            val handoff = inputData.getBoolean(KEY_HANDOFF, false)
            if (!handoff && !store.backgroundSyncEnabled) return@withContext Result.success()
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
                // JSON null reads back as the string "null" via optString.
                val sinceId = cursor.optString("sinceId").takeUnless { it == "null" }.orEmpty()
                val accountId = cursor.optString("accountId")
                val instanceUrl = cursor.optString("instanceUrl").trimEnd('/')
                // A failed lookup leaves an empty accountId; nothing to poll yet.
                if (handle.isEmpty() || accountId.isEmpty() || instanceUrl.isEmpty()) continue
                // Page forward with min_id from the cursor: each page is the
                // block right after the previous one, so an account that posted
                // more than a page between runs is walked in full. since_id would
                // return only the newest page and drop everything in between.
                // Progress is recorded per page, so a failure midway keeps what
                // was fetched and the next run resumes from there.
                // An account without a sinceId (it had no posts when first
                // loaded, or that first fetch failed) has nothing to page from:
                // one newest page sets its cursor — same as src/sync/pollFeed.ts.
                var minId = sinceId
                var rateLimited = false
                try {
                    for (page in 0 until MAX_POLL_PAGES) {
                        val posts = fetchStatuses(instanceUrl, accountId, minId, accessToken)
                        if (posts.length() == 0) break
                        for (j in 0 until posts.length()) {
                            fetched.add(posts.getJSONObject(j))
                        }
                        minId = posts.getJSONObject(0).getString("id")
                        updates[handle] =
                            JSONObject()
                                .put("lastPolledAt", System.currentTimeMillis())
                                .put("sinceId", minId)
                        // No cursor: one newest page is enough. Otherwise a short
                        // page means we've reached the newest post.
                        if (sinceId.isEmpty() || posts.length() < PAGE_SIZE) break
                    }
                    if (!updates.containsKey(handle)) {
                        updates[handle] =
                            JSONObject()
                                .put("lastPolledAt", System.currentTimeMillis())
                                .put("sinceId", sinceId)
                    }
                } catch (e: RateLimitException) {
                    // The home instance is rate-limiting us. Every account hits
                    // the same instance, so stop polling the rest this run and
                    // hold off until it says we may try again.
                    store.rateLimitedUntil = System.currentTimeMillis() + e.retryAfterMs
                    rateLimited = true
                } catch (_: Exception) {
                    // skip the rest of this account until the next run
                }
                if (rateLimited) break
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
        minId: String,
        accessToken: String,
    ): JSONArray {
        val min = if (minId.isEmpty()) "" else "min_id=$minId&"
        val url = URL("$instanceUrl/api/v1/accounts/$accountId/statuses?${min}limit=$PAGE_SIZE")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.setRequestProperty("Authorization", "Bearer $accessToken")
        // Consume the body fully and close streams without disconnect(), so the
        // TLS connection returns to the pool and the next sequential request to
        // the same home instance reuses it — fewer handshakes for the phone and
        // fewer new connections for the instance. disconnect() would evict it.
        val code = conn.responseCode
        if (code == HTTP_TOO_MANY_REQUESTS) {
            val backoff = retryAfterMs(conn)
            conn.errorStream?.use { it.readBytes() }
            throw RateLimitException(backoff)
        }
        if (code != HttpURLConnection.HTTP_OK) {
            conn.errorStream?.use { it.readBytes() }
            throw IllegalStateException("HTTP $code")
        }
        return conn.inputStream.bufferedReader().use { JSONArray(it.readText()) }
    }

    /**
     * How long to back off after a 429, from `Retry-After` (delta seconds) or
     * Mastodon's `X-RateLimit-Reset` (ISO-8601), capped to a sane maximum.
     */
    private fun retryAfterMs(conn: HttpURLConnection): Long {
        conn.getHeaderField("Retry-After")?.trim()?.toLongOrNull()?.let { seconds ->
            // Clamp seconds BEFORE multiplying so a huge value can't overflow Long.
            return seconds.coerceIn(0L, MAX_RATE_LIMIT_BACKOFF_MS / 1000) * 1000
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
        const val KEY_HANDOFF = "handoff"
        private const val PAGE_SIZE = 20

        // Cap pages per account per run so one prolific account can't stretch
        // a run indefinitely. Nothing past it is lost: the cursor sits at the
        // newest post fetched and the next run continues from there.
        private const val MAX_POLL_PAGES = 10
        private const val TIMEOUT_MS = 15_000
        private const val HTTP_TOO_MANY_REQUESTS = 429
        private const val DEFAULT_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000L
        private const val MAX_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000L
    }
}
