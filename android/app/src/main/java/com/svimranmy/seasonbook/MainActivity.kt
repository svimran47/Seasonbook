package com.svimranmy.seasonbook

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject

// Skeleton control panel — the notification engine is the product; this screen only
// wires it. The real Material You UI ships when the design pass covers Android.

class MainActivity : Activity() {

    private lateinit var out: TextView
    private lateinit var showId: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Notifier.ensureChannels(this)
        Notifier.requestPermission(this)
        Prefs.deviceId(this)

        val d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 14f, resources.displayMetrics).toInt()
        val pad = (d * 1.5f).toInt()

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(d, d, d, d)
        }

        fun label(text: String) = TextView(this).apply {
            setText(text); setPadding(0, pad / 2, 0, d / 2); textSize = 13f
        }
        fun button(text: String, onClick: () -> Unit) = Button(this).apply {
            setText(text); setOnClickListener { onClick() }
        }

        val url = EditText(this).apply {
            setText(Prefs.deviceBaseUrl(this@MainActivity)); setSingleLine(true)
        }

        out = TextView(this).apply {
            text = "device: ${Prefs.deviceId(this@MainActivity)}"
            textSize = 12f
        }

        showId = EditText(this).apply {
            hint = "tvMaze show id (169 = Breaking Bad)"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }

        col.addView(label("Worker base URL — 'adb reverse tcp:8787 tcp:8787' keeps localhost working on-device"))
        col.addView(url)
        col.addView(button("Save base URL") {
            Prefs.prefs(this).edit().putString("base_url", url.text.toString().trim()).apply()
            toast("Saved")
        })
        col.addView(out)
        col.addView(showId)
        col.addView(button("Follow + subscribe to FCM topic") { follow(subscribe = true) })
        col.addView(button("Unfollow + unsubscribe") { follow(subscribe = false) })
        col.addView(button("Sync topics for my whole shelf") { syncTopics() })
        col.addView(button("Subscribe to test topic (announce-test)") {
            val ok = TopicOps.subscribe(this, TopicOps.TEST_TOPIC)
            toast(if (ok) "Subscribed — POST /api/notify/test should reach you" else "Firebase not configured (google-services.json missing)")
        })
        col.addView(button("Pull follow list") { pullFollows() })
        col.addView(button("Run the poll worker now (reschedule alarms)") {
            NotifyEngine.pollNow(this)
            NotifyEngine.pollPeriodic(this)
            toast("Poll enqueued")
        })
        col.addView(button("Run daily digest now") {
            NotifyEngine.scheduleDailyDigest(this)
            toast("Digest scheduled + running now…")
            NotifyEngine.pollNow(this)
        })
        col.addView(button("Test local airtime notification") {
            Notifier.airtime(this, "Breaking Bad", 2, 5, "Smoke test", EngineLogic.DEVICE_LEAD_MIN, "AMC")
        })
        col.addView(button("Exact alarms: permission screen") {
            if (Build.VERSION.SDK_INT >= 31) {
                val am = getSystemService(ALARM_SERVICE) as android.app.AlarmManager
                if (!am.canScheduleExactAlarms()) {
                    startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
                    return@button
                }
            }
            toast("Exact alarms already allowed")
        })

        setContentView(ScrollView(this).apply { addView(col) })

        // Lanes live from the first launch: 4h poll → arm alarms; digest daily at 18:15.
        NotifyEngine.pollPeriodic(this)
        NotifyEngine.scheduleDailyDigest(this)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    private fun base() = Prefs.deviceBaseUrl(this).trimEnd('/')

    private fun follow(subscribe: Boolean) {
        val id = showId.text.toString().trim().toLongOrNull() ?: run { toast("Type a tvmaze show id first"); return }
        val body = JSONObject().put("deviceId", Prefs.deviceId(this)).put("showId", id)
            .put("action", if (subscribe) "add" else "remove")
        val topic = TopicOps.nameFor(id)
        Thread {
            try {
                Api.post("${base()}/api/follow", body)
                val ok = if (subscribe) TopicOps.subscribe(this, topic) else TopicOps.unsubscribe(this, topic)
                runOnUiThread {
                    out.append("\n✓ show $id ${if (subscribe) "followed" else "removed"}; topic ${if (ok) "synced ($topic)" else "skipped — firebase not configured"}")
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Follow failed: ${e.message}") }
            }
        }.start()
    }

    private fun downloadFollows(cb: (List<Pair<Long, String>>) -> Unit, fail: (String) -> Unit) {
        val dev = Prefs.deviceId(this)
        Thread {
            try {
                val j = Api.get("${base()}/api/follows?deviceId=$dev")
                val shows = j.optJSONArray("shows")
                val ids = buildList {
                    for (i in 0 until (shows?.length() ?: 0)) {
                        val s = shows!!.getJSONObject(i)
                        add(s.getLong("id") to s.optString("name"))
                    }
                }
                runOnUiThread { cb(ids) }
            } catch (e: Exception) {
                runOnUiThread { fail(e.message ?: "network error") }
            }
        }.start()
    }

    private fun pullFollows() = downloadFollows(
        cb = { ids ->
            out.text = "device: ${Prefs.deviceId(this)}\nshelf (${ids.size}): ${ids.joinToString(", ") { it.second }}"
        },
        fail = { toast("Pull failed: $it") },
    )

    private fun syncTopics() = downloadFollows(
        cb = { ids ->
            var ok = 0
            for ((id, _) in ids) if (TopicOps.subscribe(this, TopicOps.nameFor(id))) ok++
            out.append("\n✓ topics synced: $ok/${ids.size}" + (if (ok < ids.size) " — rest need google-services.json" else ""))
        },
        fail = { toast("Sync failed: $it") },
    )
}
