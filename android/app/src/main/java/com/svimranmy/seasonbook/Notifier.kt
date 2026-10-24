package com.svimranmy.seasonbook

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.util.Calendar

// Two contract channels: "airtime" MUST exist under exactly this id or FCM tray payloads
// for that channel drop silently (the worker sets android.notification.channel_id=airtime);
// "digest" carries the daily wrap. Quiet hours 22:00–07:00 honored per design/BRIEF.md.
object Notifier {
    const val CH_AIRTIME = "airtime"
    const val CH_DIGEST = "digest"

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CH_AIRTIME, "Airtimes", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Episode start reminders"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DIGEST, "Daily digest", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "One quiet wrap of tonight's schedule"
            }
        )
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun requestPermission(activity: Activity) {
        if (Build.VERSION.SDK_INT >= 33 && !canPost(activity)) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 42)
        }
    }

    /** Device/FCM airtime reminder — contract copy: "show · SxxEyy" + fact + time offset. */
    fun airtime(
        ctx: Context, showName: String, season: Int?, number: Int?,
        episodeName: String?, minutesToAir: Long, network: String?,
        episodeId: String = "local-test",
    ) = show(
        ctx, CH_AIRTIME,
        EngineLogic.title(showName, season, number),
        EngineLogic.body(episodeName, minutesToAir, network),
        episodeId.hashCode(),
        // watched action posts back to the worker (Open action is the content intent)
        NotificationCompat.Action(
            android.R.drawable.ic_menu_save, "Watched",
            PendingIntent.getBroadcast(
                ctx, episodeId.hashCode(),
                Intent(ctx, WatchedActionReceiver::class.java).putExtra("episode_id", episodeId),
                PendingIntent.FLAG_IMMUTABLE,
            )
        ),
    )

    fun digest(ctx: Context, text: String) = show(ctx, CH_DIGEST, "Tonight on Seasonbook", text, 7)

    /** Public render for foreground FCM payloads (service hands title/body over). */
    fun showDetailed(ctx: Context, channel: String, title: String, body: String, episodeId: String?) =
        show(ctx, channel, title, body, (episodeId ?: "fcm").hashCode())

    private fun show(ctx: Context, channel: String, title: String, body: String, id: Int, action: NotificationCompat.Action? = null) {
        // Digest uses the same quiet-hours rule; the test/airtime lane never wakes anyone after 22:00.
        if (channel == CH_AIRTIME && EngineLogic.isQuietHour(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))) return
        if (!canPost(ctx)) return
        val tap = PendingIntent.getActivity(
            ctx, id,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
        action?.let { builder.addAction(it) }
        try {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, builder.build())
        } catch (_: SecurityException) {
        }
    }
}
