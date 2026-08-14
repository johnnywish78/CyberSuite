package com.johnny.cloudpilot

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit
import com.google.android.material.bottomnavigation.BottomNavigationView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * CloudPilot — Android client.
 *
 * Talks to the CloudPilot backend over the same `/api/v1` contracts the
 * desktop renderer uses. The backend URL defaults to the Android
 * emulator host loopback (`10.0.2.2`) and is editable in Settings for
 * physical devices / LAN usage.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val DEFAULT_BACKEND = "http://10.0.2.2:8765"
        private const val PREFS = "cloudpilot"
    }

    private lateinit var pageContainer: FrameLayout
    private lateinit var bottomNav: BottomNavigationView

    private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .build()

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    private val pages = HashMap<String, View>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        pageContainer = findViewById(R.id.page_container)
        bottomNav = findViewById(R.id.bottom_nav)

        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_dashboard -> showPage("dashboard")
                R.id.nav_workers -> showPage("workers")
                R.id.nav_deployments -> showPage("deployments")
                R.id.nav_railway -> showPage("railway")
                R.id.nav_settings -> showPage("settings")
                else -> return@setOnItemSelectedListener false
            }
            true
        }

        showPage("dashboard")
    }

    private fun baseUrl(): String {
        return prefs.getString("backend_url", DEFAULT_BACKEND) ?: DEFAULT_BACKEND
    }

    private fun showPage(name: String) {
        val existing = pages[name]
        if (existing != null) {
            switchTo(existing)
            return
        }

        val view: View = if (name == "settings") {
            buildSettingsPage()
        } else {
            buildScrollPage(name)
        }

        pages[name] = view
        switchTo(view)
    }

    private fun switchTo(view: View) {
        pageContainer.removeAllViews()
        pageContainer.addView(view, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    /* ---------------------------------------------------------------- *
     *  Generic scrollable page with a title and a content list
     * ---------------------------------------------------------------- */
    private fun buildScrollPage(name: String): View {
        val view = layoutInflater.inflate(R.layout.page_scroll, pageContainer, false)
        val list = view.findViewById<LinearLayout>(R.id.page_list)
        val status = view.findViewById<TextView>(R.id.page_status)

        val (title, subtitle) = when (name) {
            "workers" -> Pair("Workers", "Cloudflare Workers on the configured account")
            "deployments" -> Pair("Deployments", "Cloudflare BPB deployment history")
            "railway" -> Pair("Railway", "Avaco Railway Relay deployments")
            else -> Pair("Dashboard", "Backend and provider status")
        }

        view.findViewById<TextView>(R.id.page_title).text = title
        status.text = "Loading…"
        list.removeAllViews()

        loadPage(name, list, status, view)
        return view
    }

    private fun loadPage(name: String, list: LinearLayout, status: TextView, view: View) {
        val path = when (name) {
            "workers" -> "/api/v1/cloudflare/workers"
            "deployments" -> "/api/v1/cloudflare/bpb/deployments"
            "railway" -> "/api/v1/railway/deployments"
            else -> "/api/health"
        }

        fetch(path) { code, text ->
            when {
                code == -1 -> {
                    status.text = "Backend unreachable: $text"
                    status.setTextColor(0xFFFF5252.toInt())
                }
                code !in 200..299 -> {
                    status.text = "HTTP $code"
                    status.setTextColor(0xFFFF5252.toInt())
                }
                else -> {
                    status.text = "OK · HTTP $code"
                    status.setTextColor(0xFF4CAF50.toInt())
                    renderResponse(name, text, list)
                }
            }
        }
    }

    private fun renderResponse(name: String, body: String, list: LinearLayout) {
        list.removeAllViews()
        val json = JSONObject(body)

        when (name) {
            "dashboard" -> renderHealth(json, list)
            "workers" -> renderArray(json, "workers", list)
            "deployments", "railway" -> renderArray(json, "deployments", list)
        }
    }

    private fun renderHealth(json: JSONObject, list: LinearLayout) {
        addRow(list, "service", json.optString("service", "-"))
        addRow(list, "version", json.optString("version", "-"))
        addRow(list, "uptime_s", json.optString("uptime_seconds", "-"))
    }

    private fun renderArray(json: JSONObject, key: String, list: LinearLayout) {
        addRow(list, "count", json.optInt(key).let { if (json.has(key)) it.toString() else "-" })
        val array = json.optJSONArray(key) ?: return

        if (array.length() == 0) {
            addRow(list, "note", "no records")
            return
        }

        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val title = firstTitle(item)
            addSection(list, title.ifEmpty { "record ${i + 1}" })
            val keys = item.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val v = item.opt(k)
                val s = when (v) {
                    is JSONObject -> "{object}"
                    is JSONArray -> "[array:${v.length()}]"
                    JSONObject.NULL -> "-"
                    else -> v.toString()
                }
                addRow(list, k, s)
            }
        }
    }

    private fun firstTitle(item: JSONObject): String {
        for (candidate in listOf("name", "id", "relay_name", "worker_name", "status")) {
            val v = item.optString(candidate)
            if (v.isNotEmpty()) return v
        }
        return ""
    }

    private fun addSection(container: LinearLayout, text: String) {
        val tv = TextView(this)
        tv.text = text
        tv.textSize = 16f
        tv.setTextColor(0xFF3B82F6.toInt())
        tv.setPadding(dp(4), dp(14), dp(4), dp(4))
        container.addView(tv)
    }

    private fun addRow(container: LinearLayout, title: String, value: String) {
        val tv = TextView(this)
        tv.text = "$title  $value"
        tv.textSize = 14f
        tv.setTextIsSelectable(true)
        tv.setPadding(dp(4), dp(5), dp(4), dp(5))
        container.addView(tv)
    }

    /* ---------------------------------------------------------------- *
     *  Settings page
     * ---------------------------------------------------------------- */
    private fun buildSettingsPage(): View {
        val view = layoutInflater.inflate(R.layout.page_settings, pageContainer, false)

        val backend = view.findViewById<EditText>(R.id.input_backend)
        backend.setText(prefs.getString("backend_url", DEFAULT_BACKEND) ?: DEFAULT_BACKEND)
        view.findViewById<EditText>(R.id.input_account).setText(
            prefs.getString("cf_account", "") ?: ""
        )
        view.findViewById<EditText>(R.id.input_token).setText(
            prefs.getString("cf_token", "") ?: ""
        )
        view.findViewById<EditText>(R.id.input_railway).setText(
            prefs.getString("railway_token", "") ?: ""
        )
        view.findViewById<EditText>(R.id.input_proxy).setText(
            prefs.getString("cf_proxy", "") ?: ""
        )

        view.findViewById<Button>(R.id.btn_save_backend).setOnClickListener {
            prefs.edit { putString("backend_url", backend.text.toString().trim()) }
            toast("Backend URL saved")
        }

        view.findViewById<Button>(R.id.btn_test).setOnClickListener {
            fetchFrom(backend.text.toString().trim(), "/api/health") { code, text ->
                toast(if (code == 200) "Backend OK · v${parseVersion(text)}" else "Backend error: HTTP $code $text")
            }
        }

        view.findViewById<Button>(R.id.btn_save_cf).setOnClickListener {
            val account = view.findViewById<EditText>(R.id.input_account).text.toString().trim()
            val token = view.findViewById<EditText>(R.id.input_token).text.toString().trim()
            prefs.edit {
                putString("cf_account", account)
                putString("cf_token", token)
            }
            val body = JSONObject()
                .put("account_id", account)
                .put("api_token", token)
                .toString()
            fetchFrom(backend.text.toString().trim(), "/api/v1/cloudflare/config", "POST", body) { code, text ->
                toast(if (code in 200..299) "Cloudflare config saved" else "Save failed: HTTP $code $text")
            }
        }

        view.findViewById<Button>(R.id.btn_save_railway).setOnClickListener {
            val token = view.findViewById<EditText>(R.id.input_railway).text.toString().trim()
            prefs.edit { putString("railway_token", token) }
            val body = JSONObject().put("api_token", token).toString()
            fetchFrom(backend.text.toString().trim(), "/api/v1/railway/config", "POST", body) { code, text ->
                toast(if (code in 200..299) "Railway config saved" else "Save failed: HTTP $code $text")
            }
        }

        return view
    }

    private fun parseVersion(body: String): String {
        return try {
            JSONObject(body).optString("version", "-")
        } catch (e: Exception) {
            "-"
        }
    }

    /* ---------------------------------------------------------------- *
     *  HTTP helpers
     * ---------------------------------------------------------------- */
    private fun fetch(path: String, onResult: (Int, String) -> Unit) {
        fetchFrom(baseUrl(), path, "GET", null, onResult)
    }

    private fun fetchFrom(base: String, path: String, method: String = "GET", body: String? = null, onResult: (Int, String) -> Unit) {
        if (base.isEmpty()) {
            main.post { onResult(-1, "backend URL not set") }
            return
        }

        val url = base.trimEnd('/') + path
        val builder = Request.Builder().url(url)

        if (method == "POST") {
            val media = "application/json; charset=utf-8".toMediaType()
            builder.post((body ?: "").toRequestBody(media))
        }

        executor.execute {
            try {
                client.newCall(builder.build()).execute().use { response ->
                    val text = response.body?.string() ?: ""
                    main.post { onResult(response.code, text) }
                }
            } catch (e: IOException) {
                main.post { onResult(-1, e.message ?: "network error") }
            }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}