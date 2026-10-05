package io.github.lens0021.subee

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature

class MainActivity : Activity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            // domStorageEnabled covers localStorage and IndexedDB, which the app
            // uses; the deprecated WebSQL (databaseEnabled) is not needed.
            domStorageEnabled = true
            // Needed for onCreateWindow to fire for target="_blank" links.
            setSupportMultipleWindows(true)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.addJavascriptInterface(SubeeBridge(this), "SubeeAndroid")

        val assetLoader =
            WebViewAssetLoader.Builder()
                .addPathHandler("/", WebAppPathHandler(this))
                .build()

        // Requests made by (or for pages controlled by) the PWA service worker
        // bypass WebViewClient.shouldInterceptRequest, so the appassets domain
        // would hit real DNS and fail with ERR_NAME_NOT_RESOLVED. Route them
        // through the same asset loader.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                object : ServiceWorkerClientCompat() {
                    override fun shouldInterceptRequest(
                        request: WebResourceRequest,
                    ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
                },
            )
        }

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
                    // Main-frame http/https stays in the WebView — the app itself
                    // and the Mastodon OAuth flow (which redirects back to the
                    // appassets origin) navigate in place. Post links use
                    // target="_blank" and are handled by onCreateWindow instead.
                    val scheme = request.url.scheme
                    if (scheme == "http" || scheme == "https") return false
                    openExternally(request.url)
                    return true
                }
            }

        webView.webChromeClient =
            object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: Message,
                ): Boolean {
                    // target="_blank" links (post/profile/media links) open in the
                    // system browser, leaving the app's WebView untouched so
                    // returning resumes exactly where the user left off.
                    val popup = WebView(view.context)
                    var reclaimed = false
                    fun reclaim() {
                        if (!reclaimed) {
                            reclaimed = true
                            popup.destroy()
                        }
                    }
                    popup.webViewClient =
                        object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                v: WebView,
                                request: WebResourceRequest,
                            ): Boolean {
                                openExternally(request.url)
                                v.post { reclaim() }
                                return true
                            }
                        }
                    // A fragment/URL-less open (e.g. href="#") may never hit
                    // shouldOverrideUrlLoading, which would leak this WebView;
                    // reclaim it shortly regardless.
                    popup.postDelayed({ reclaim() }, POPUP_RECLAIM_MS)
                    (resultMsg.obj as WebView.WebViewTransport).webView = popup
                    resultMsg.sendToTarget()
                    return true
                }
            }

        if (SyncStore(applicationContext).backgroundSyncEnabled) {
            FeedSyncScheduler.ensureScheduled(applicationContext)
            // The worker silently drops its notification without this
            // permission, and it can be revoked after it was first granted.
            ensureNotificationPermission()
        }

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL)
        } else {
            webView.restoreState(savedInstanceState)
            if (webView.url == null) webView.loadUrl(APP_URL)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            // Nudge the page-visibility handler so a warm resume drains any
            // background-fetched posts and clears the notification. (WebView does
            // not reliably fire visibilitychange on activity resume by itself.)
            webView.evaluateJavascript(
                "document.dispatchEvent(new Event('visibilitychange'))",
                null,
            )
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) webView.onPause()
        super.onPause()
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

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
            // no app to handle the link — ignore
        }
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
        private const val POPUP_RECLAIM_MS = 2000L
    }
}
