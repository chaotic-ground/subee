package io.github.lens0021.subee

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

object FeedSyncScheduler {
    private const val WORK_NAME = "subee-feed-sync"
    private const val HANDOFF_WORK_NAME = "subee-feed-sync-handoff"
    // Target minimum interval; WorkManager defers actual runs based on Doze /
    // battery, so real spacing is often longer.
    private const val INTERVAL_HOURS = 4L

    fun schedule(context: Context) {
        val request =
            PeriodicWorkRequestBuilder<FeedSyncWorker>(INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(constraints())
                .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * Re-enqueue on app launch when background sync is on, without resetting
     * the existing schedule (KEEP). Heals a periodic job that was dropped, e.g.
     * by an OEM battery manager clearing scheduled jobs.
     */
    fun ensureScheduled(context: Context) {
        val request =
            PeriodicWorkRequestBuilder<FeedSyncWorker>(INTERVAL_HOURS, TimeUnit.HOURS)
                .setConstraints(constraints())
                .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /**
     * Finish an in-app refresh the user walked away from: the WebView's fetches
     * stall or die once the app is backgrounded, so poll natively instead and
     * notify when new posts arrive. Runs even with periodic sync off, since the
     * user explicitly asked for this refresh.
     */
    fun handOff(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<FeedSyncWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .setInputData(workDataOf(FeedSyncWorker.KEY_HANDOFF to true))
                .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(HANDOFF_WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    private fun constraints() =
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            // Don't spend battery prefetching when it's already low.
            .setRequiresBatteryNotLow(true)
            .build()

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
