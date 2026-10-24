package com.svimranmy.seasonbook

import java.time.Instant

// Pure notification logic — no Android imports, unit-tested in CI (android/app/src/test).
// Contract (design/BRIEF.md): title = "show · SxxEyy", body = one fact + time offset,
// quiet hours 22:00–07:00 local, and the device lane fires well ahead of the server's
// ≤75-min FCM lane so the two never double-notify at the same moment.

object EngineLogic {
    const val DEVICE_LEAD_MIN = 120L // device lane: "on tonight" heads-up

    const val QUIET_FROM_HOUR = 22
    const val QUIET_TO_HOUR = 7

    fun code(season: Int?, number: Int?): String =
        if (number != null) "S%02dE%02d".format(season ?: 0, number)
        else if (season != null) "S$season special" else "Special"

    fun title(showName: String, season: Int?, number: Int?): String =
        "$showName · ${code(season, number)}"

    fun body(episodeName: String?, minutesToAir: Long, network: String?): String {
        val fact = episodeName?.takeIf { it.isNotBlank() }?.let { "“$it” — " } ?: "New episode — "
        val where = network?.takeIf { it.isNotBlank() }?.let { " on $it" } ?: ""
        return "$fact${leadLabel(minutesToAir)}$where."
    }

    fun leadLabel(minutes: Long): String = when {
        minutes <= 0 -> "starts now"
        minutes >= 110 -> "starts in ~2 h"
        minutes >= 55 -> "starts in ~1 h"
        else -> "starts in $minutes min"
    }

    // 22:00–06:59 local counts as quiet; the daily digest uses the same rule.
    fun isQuietHour(hour: Int): Boolean = hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR

    // air_utc is always the worker's normalized ISO-8601 UTC ("2026-01-01T02:00:00.000Z").
    fun parseIsoToMillis(iso: String): Long? =
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
}
