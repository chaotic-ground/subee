package io.github.lens0021.subee

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object FeedSyncScheduler {
    private const val WORK_NAME = "subee-feed-sync"
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
