package com.svimranmy.seasonbook

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// Minimal JSON-over-HTTP — org.json ships with Android, HttpURLConnection needs no library.
object Api {

    class HttpException(val status: Int, message: String) : RuntimeException(message)

    fun get(url: String): JSONObject = request(url, "GET", null)

    fun post(url: String, body: JSONObject): JSONObject = request(url, "POST", body)

    private fun request(urlStr: String, method: String, body: JSONObject?): JSONObject {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            if (body != null) {
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw HttpException(code, "HTTP $code: ${text.take(160)}")
            return JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
