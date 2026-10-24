package com.svimranmy.seasonbook

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/** Fires ~2 h before an airtime (device lane). Renders the contract copy, marks the row notified. */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val episodeId = intent.getStringExtra("episode_id") ?: return
        val airMs = intent.getLongExtra("air_ms", System.currentTimeMillis())
        val minutesToAir = ((airMs - System.currentTimeMillis()) / 60_000L).coerceAtLeast(0)
        Notifier.airtime(
            context,
            showName = intent.getStringExtra("show_name") ?: "Seasonbook",
            season = intent.getIntExtra("season", 0),
            number = intent.getIntExtra("number", -1).takeIf { it != -1 },
            episodeName = intent.getStringExtra("episode_name"),
            minutesToAir = minutesToAir,
            network = intent.getStringExtra("network"),
            episodeId = episodeId,
        )
        Store(context).markNotified(episodeId)
    }
}

/** Tapping "Watched" on a notification posts the watchmark back to the worker. */
class WatchedActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val episodeId = intent.getStringExtra("episode_id")?.toLongOrNull() ?: return
        val base = Prefs.deviceBaseUrl(context).trimEnd('/')
        val body = JSONObject()
            .put("deviceId", Prefs.deviceId(context))
            .put("episodeId", episodeId)
            .put("state", "add")
        Thread {
            try {
                Api.post("$base/api/watched", body)
            } catch (_: Exception) {
                // offline is fine — the tap just doesn't stick; the user can mark it on the shelf
            }
        }.start()
    }
}

/** After a reboot or an app update, lanes must re-arm — OEM battery taxis otherwise win. */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        NotifyEngine.pollNow(context)  // poll refreshes data, then armAlarms() runs inside the worker
        NotifyEngine.pollPeriodic(context)
        NotifyEngine.scheduleDailyDigest(context)
    }
}
