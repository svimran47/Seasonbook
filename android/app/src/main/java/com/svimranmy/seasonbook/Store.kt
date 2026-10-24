package com.svimranmy.seasonbook

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.UUID

// Device-side memory: known airtimes (SQLite) + identity/settings (SharedPreferences).
// deviceId is the same pre-accounts stand-in the worker uses — the app makes its own and
// the web PWA never needs to know about it.

data class AirtimeRow(
    val episodeId: String,
    val showId: Long,
    val showName: String,
    val season: Int,
    val number: Int,
    val episodeName: String?,
    val network: String?,
    val airUtc: String,
    val notified: Boolean,
)

class Store(context: Context) : SQLiteOpenHelper(context, "seasonbook.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE airtimes (" +
                "episode_id TEXT PRIMARY KEY, show_id INTEGER, show_name TEXT, " +
                "season INTEGER, number INTEGER, episode_name TEXT, network TEXT, " +
                "air_utc TEXT, notified INTEGER DEFAULT 0)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun upsertAirtime(
        episodeId: String, showId: Long, showName: String, season: Int, number: Int?,
        episodeName: String?, network: String?, airUtc: String,
    ) {
        // CONFLICT_IGNORE keeps each episode's notified flag across polls; fields stay fresh.
        writableDatabase.insertWithOnConflict(
            "airtimes", null,
            ContentValues().apply {
                put("episode_id", episodeId)
                put("show_id", showId)
                put("show_name", showName)
                put("season", season)
                put("number", number ?: -1)
                put("episode_name", episodeName)
                put("network", network)
                put("air_utc", airUtc)
            },
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        writableDatabase.update(
            "airtimes",
            ContentValues().apply {
                put("air_utc", airUtc)
                put("episode_name", episodeName)
                put("network", network)
                put("show_name", showName)
            },
            "episode_id=?", arrayOf(episodeId),
        )
    }

    fun notNotified(): List<AirtimeRow> = readableDatabase.rawQuery(
        "SELECT episode_id, show_id, show_name, season, number, episode_name, network, air_utc, notified " +
            "FROM airtimes WHERE notified=0 AND air_utc IS NOT NULL ORDER BY air_utc",
        null,
    ).use { c ->
        buildList {
            while (c.moveToNext()) {
                add(
                    AirtimeRow(
                        episodeId = c.getString(0),
                        showId = c.getLong(1),
                        showName = c.getString(2) ?: "",
                        season = c.getInt(3),
                        number = c.getInt(4),
                        episodeName = if (c.isNull(5)) null else c.getString(5),
                        network = if (c.isNull(6)) null else c.getString(6),
                        airUtc = c.getString(7) ?: continue,
                        notified = c.getInt(8) != 0,
                    )
                )
            }
        }
    }

    fun markNotified(episodeId: String) {
        writableDatabase.update("airtimes", ContentValues().apply { put("notified", 1) }, "episode_id=?", arrayOf(episodeId))
    }

    fun pruneOld(isoCutoff: String) {
        writableDatabase.execSQL("DELETE FROM airtimes WHERE air_utc < ?", arrayOf(isoCutoff))
    }
}

object Prefs {
    fun prefs(ctx: Context) = ctx.getSharedPreferences("seasonbook", Context.MODE_PRIVATE)

    fun deviceId(ctx: Context): String =
        prefs(ctx).getString("device_id", null)
            ?: UUID.randomUUID().toString().also { prefs(ctx).edit().putString("device_id", it).apply() }

    fun deviceBaseUrl(ctx: Context): String =
        prefs(ctx).getString("base_url", "http://127.0.0.1:8787") ?: "http://127.0.0.1:8787"

    fun digestHour(ctx: Context): Int = prefs(ctx).getInt("digest_hour", 18)
}
