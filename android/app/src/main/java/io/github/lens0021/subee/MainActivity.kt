package io.github.lens0021.subee

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.addJavascriptInterface(SubeeBridge(this), "SubeeAndroid")

        val assetLoader =
            WebViewAssetLoader.Builder()
                .addPathHandler("/", WebAppPathHandler(this))
                .build()

        webView.webViewClient =
            object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    // http/https stays in the WebView — the Mastodon OAuth flow
                    // must redirect back to the appassets origin in-place.
                    val scheme = request.url.scheme
                    if (scheme == "http" || scheme == "https") return false
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                        true
                    } catch (_: Exception) {
                        true
                    }
                }
            }

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL)
        } else {
            webView.restoreState(savedInstanceState)
            if (webView.url == null) webView.loadUrl(APP_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    companion object {
        // Served by WebViewAssetLoader from assets/www (the vite build output)
        const val APP_URL = "https://appassets.androidplatform.net/"
    }
}
