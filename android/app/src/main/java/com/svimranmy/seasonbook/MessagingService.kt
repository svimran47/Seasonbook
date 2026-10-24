package com.svimranmy.seasonbook

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// ── Lane 1: FCM topic-per-show ───────────────────────────────────────────────
// The app subscribes ITSELF to "show-<tvmazeId>" on follow (server never sees tokens —
// topic model per design/BRIEF.md). Background tray payloads render via channel_id
// "airtime" automatically; foreground payloads land in onMessageReceived and we render.

object TopicOps {
    const val TEST_TOPIC = "announce-test"

    fun nameFor(showId: Long) = "show-$showId"

    /** @return true when the subscription was accepted (Firebase configured on-device). */
    fun subscribe(ctx: Context, topic: String): Boolean = try {
        FirebaseMessaging.getInstance().subscribeToTopic(topic)
        true
    } catch (_: IllegalStateException) {
        // "Default FirebaseApp is not initialized" — google-services.json missing; setup card territory.
        false
    }

    /** @return true when the unsubscription was accepted. */
    fun unsubscribe(ctx: Context, topic: String): Boolean = try {
        FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)
        true
    } catch (_: IllegalStateException) {
        false
    }
}

class MessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        // Tokens are a device detail only: topic fan-out needs no token registry server-side.
        getSharedPreferences("seasonbook", MODE_PRIVATE)
            .edit().putString("fcm_token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Foreground render (background payloads are auto-shown by the tray with channel "airtime").
        val n = message.notification ?: return
        if (message.data["type"] == "airtime" || message.data["type"] == "test") {
            Notifier.showDetailed(applicationContext, Notifier.CH_AIRTIME, n.title ?: "Seasonbook", n.body ?: "", message.data["episode_id"])
        }
    }
}
