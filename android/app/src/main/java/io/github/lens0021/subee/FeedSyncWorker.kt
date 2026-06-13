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
                } catch (_: Exception) {
                    // skip this account until the next run
                }
            }

            if (updates.isNotEmpty()) {
                val added = store.recordPollResults(updates, fetched)
                if (added > 0) {
                    Notifications.showNewPosts(applicationContext, added)
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
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IllegalStateException("HTTP ${conn.responseCode}")
            }
            return JSONArray(conn.inputStream.bufferedReader().readText())
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val PAGE_SIZE = 20
        private const val TIMEOUT_MS = 15_000
    }
}
