package io.github.lens0021.subee

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.IOException

/**
 * Serves the bundled web build (assets/www) and falls back to index.html
 * for SPA routes such as the OAuth callback at "/".
 */
class WebAppPathHandler(private val context: Context) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val clean = path.removePrefix("/")
        val assetPath = clean.ifEmpty { "index.html" }
        val direct = open(assetPath)
        if (direct != null) return direct
        // Extension-less paths are SPA routes
        return if (!assetPath.substringAfterLast('/').contains('.')) open("index.html") else null
    }

    private fun open(assetPath: String): WebResourceResponse? =
        try {
            val stream = context.assets.open("www/$assetPath")
            val mime = guessMimeType(assetPath)
            val encoding = if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) "utf-8" else null
            WebResourceResponse(mime, encoding, stream)
        } catch (_: IOException) {
            null
        }

    private fun guessMimeType(path: String): String =
        when (path.substringAfterLast('.', "")) {
            "html" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json", "map", "webmanifest" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "txt" -> "text/plain"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
}
