package com.svimranmy.seasonbook

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.util.Calendar
import java.util.concurrent.TimeUnit

// ── Lane 2: device reschedule ────────────────────────────────────────────────
// A 4-hour WorkManager poll refreshes known airtimes from /api/tonight, then arms
// exact alarms that fire ~2 h before each airtime (deliberately ahead of the
// server's ≤75-min FCM lane so a healthy device never gets a double-fire at the
// same instant — two complementary lanes per design/BRIEF.md, not duplicates).

object NotifyEngine {

    fun pollPeriodic(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            "sb-poll",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<PollWorker>(4, TimeUnit.HOURS).build(),
        )
    }

    fun pollNow(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniqueWork(
            "sb-poll-now", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<PollWorker>().build(),
        )
    }

    fun scheduleDailyDigest(ctx: Context, hour: Int = Prefs.digestHour(ctx)) {
        val now = Calendar.getInstance()
        val target = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, 15)
            set(Calendar.SECOND, 0)
            if (timeInMillis <= now.timeInMillis) add(Calendar.DAY_OF_YEAR, 1)
        }
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            "sb-digest",
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<DigestWorker>(24, TimeUnit.HOURS)
                .setInitialDelay(target.timeInMillis - now.timeInMillis, TimeUnit.MILLISECONDS)
                .build(),
        )
    }

    /** (Re)arm device-lane alarms for every not-yet-notified known airtime. */
    fun armAlarms(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val now = System.currentTimeMillis()
        val store = Store(ctx)
        for (row in store.notNotified()) {
            val air = EngineLogic.parseIsoToMillis(row.airUtc) ?: continue
            if (air <= now) { // stale — server lane or nobody ahead of it
                store.markNotified(row.episodeId)
                continue
            }
            var trigger = air - EngineLogic.DEVICE_LEAD_MIN * 60_000
            if (trigger < now) trigger = now + 60_000 // poll woke up late; remind immediately
            if (trigger - now > 24 * 60 * 60_000L) continue // far future — next poll reschedules it
            val pi = alarmIntent(ctx, row, air)
            val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi) // degraded grant: still arrives, maybe late
        }
    }

    private fun alarmIntent(ctx: Context, row: AirtimeRow, airMs: Long): PendingIntent =
        PendingIntent.getBroadcast(
            ctx,
            row.episodeId.hashCode(),
            Intent(ctx, AlarmReceiver::class.java)
                .putExtra("episode_id", row.episodeId)
                .putExtra("show_name", row.showName)
                .putExtra("season", row.season)
                .putExtra("number", row.number)
                .putExtra("episode_name", row.episodeName)
                .putExtra("network", row.network)
                .putExtra("air_ms", airMs),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}

class PollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        return try {
            val base = Prefs.deviceBaseUrl(ctx).trimEnd('/')
            val dev = Prefs.deviceId(ctx)
            val j = Api.get("$base/api/tonight?deviceId=$dev&window=24")
            val store = Store(ctx)
            val eps: JSONArray = j.optJSONArray("episodes") ?: JSONArray()
            for (i in 0 until eps.length()) {
                val e = eps.getJSONObject(i)
                store.upsertAirtime(
                    episodeId = e.getString("id"),
                    showId = e.getLong("show_id"),
                    showName = e.optString("show_name"),
                    season = e.optInt("season"),
                    number = if (e.isNull("number")) null else e.optInt("number"),
                    episodeName = if (e.isNull("episode_name")) null else e.optString("episode_name"),
                    network = if (e.isNull("network")) null else e.optString("network"),
                    airUtc = e.getString("air_utc"),
                )
            }
            store.pruneOld(java.time.Instant.ofEpochMilli(System.currentTimeMillis() - 48 * 3600_000L).toString())
            NotifyEngine.armAlarms(ctx)
            Result.success()
        } catch (e: Api.HttpException) {
            if (e.status >= 500) Result.retry() else Result.failure()
        } catch (e: Exception) {
            Result.retry() // transient network / parse hiccup: backoff and try again
        }
    }
}

class DigestWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val ctx = applicationContext
        return try {
            val base = Prefs.deviceBaseUrl(ctx).trimEnd('/')
            val dev = Prefs.deviceId(ctx)
            val j = Api.get("$base/api/tonight?deviceId=$dev&window=24")
            val eps: JSONArray = j.optJSONArray("episodes") ?: JSONArray()
            val fresh = buildList {
                for (i in 0 until eps.length()) {
                    val e = eps.getJSONObject(i)
                    if (e.optInt("watched", 0) == 0) add(e)
                }
            }
            if (fresh.isNotEmpty() && !EngineLogic.isQuietHour(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))) {
                val names = fresh.take(3).map { it.optString("show_name") }
                val extra = if (fresh.size > 3) " +${fresh.size - 3} more" else ""
                Notifier.digest(ctx, "${fresh.size} new episodes in the next 24 h: ${names.joinToString(", ")}$extra")
            }
            Result.success()
        } catch (e: Api.HttpException) {
            if (e.status >= 500) Result.retry() else Result.failure()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
