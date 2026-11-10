package dev.dsh.office.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * DSH Office TV — thin WebView client (see CONTRACT.md §5).
 *
 * Responsibilities:
 *  - fullscreen immersive WebView of the Mac bridge page (http://<mac>:8765/tv)
 *  - remote-control key handling: short OK = poke, long OK (>=600 ms) = open chat panel
 *  - JS bridge (DshTvNative / window.DshTv) and Chinese TTS
 *  - keep screen on, never white screen, reload every 5 s when the Mac is unreachable
 *  - survive WebView renderer death by rebuilding the WebView
 */
public class MainActivity extends Activity {
    private static final String TAG = "DshTv";

    private static final String PREFS_NAME = "tv_url";
    private static final String PREF_KEY = "tv_url";
    private static final String PREF_KEY_ALT = "url";

    private static final String DEFAULT_URL = "http://10.0.2.2:8765/tv";
    private static final String DISCOVERY_REQUEST = "DSH_OFFICE_TV?";
    private static final String DISCOVERY_REPLY_PREFIX = "DSH_OFFICE_TV!";
    private static final int DISCOVERY_PORT = 8766;
    private static final long DISCOVERY_TIMEOUT_MS = 1500;

    private static final long LONG_PRESS_MS = 600;
    private static final long RETRY_DELAY_MS = 5000;
    private static final long LOAD_TIMEOUT_MS = 8000;

    /** requestCode for the system speech recognizer (RecognizerIntent shell). */
    private static final int REQ_VOICE = 7001;
    /** If the recognizer UI never comes back, report "timeout" to the page. */
    private static final long VOICE_TIMEOUT_MS = 20000;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private FrameLayout root;
    private WebView webView;
    private TextView overlay;

    /** Page finished loading; keys before this are dropped. */
    private volatile boolean pageLoaded;
    /** Page called DshTvNative.ready(). */
    private volatile boolean pageReady;
    private String currentUrl;
    private boolean urlFromIntent;
    private int failureCount;
    /**
     * True while the current load attempt has already failed (error page). WebView's own
     * error page still fires onPageFinished — without this flag the overlay would be
     * hidden and keys enabled on the error page (white/blank screen bug).
     */
    private volatile boolean loadFailed;

    private boolean retryScheduled;

    // ---- long-press state -------------------------------------------------
    private boolean okDown;
    /** 600 ms postDelayed timer fired (CONTRACT §5 主路径). */
    private boolean longPressFired;
    /** System set KeyEvent.FLAG_LONG_PRESS (repeat / injected --longpress). */
    private boolean flagLongPress;
    /** KeyEvent.getDownTime() of the current press — event timebase, robust to UI lag. */
    private long okDownAt;
    /** Uptime when we actually handled the down event (fallback for odd event times). */
    private long okDownWallClock;
    private final Runnable longPressRunnable = new Runnable() {
        @Override
        public void run() {
            if (okDown && !longPressFired) {
                longPressFired = true;
                Log.i(TAG, "DshTv: long press armed (600 ms timer)");
            }
        }
    };

    // ---- TTS --------------------------------------------------------------
    private TextToSpeech tts;
    private boolean ttsReady;
    private final AtomicInteger utteranceSeq = new AtomicInteger();

    // ---- voice test (RecognizerIntent shell, CONTRACT §4.1) ---------------
    /** True between startActivityForResult() and its result / 20 s timeout. */
    private boolean voicePending;
    private final Runnable voiceTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (!voicePending) {
                return;
            }
            voicePending = false;
            Log.i(TAG, "voice: timeout after " + VOICE_TIMEOUT_MS
                    + " ms (recognizer never returned)");
            callbackVoice(false, null, "timeout");
        }
    };

    // ---- retry / watchdog -------------------------------------------------
    private final Runnable loadTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (!pageLoaded) {
                Log.w(TAG, "DshTv: load timeout for " + currentUrl);
                onLoadFailed("timeout");
            }
        }
    };
    private final Runnable retryRunnable = new Runnable() {
        @Override
        public void run() {
            retryScheduled = false;
            if (isFinishing() || isDestroyed()) {
                return;
            }
            failureCount++;
            Log.i(TAG, "DshTv: retry #" + failureCount + " -> " + currentUrl);
            // Every 3rd failed attempt, re-run UDP discovery so a changed Mac IP is picked up.
            if (!urlFromIntent && failureCount % 3 == 0) {
                rediscoverThenReload();
            } else {
                loadUrlWithWatchdog(currentUrl);
            }
        }
    };

    // =======================================================================
    // Lifecycle
    // =======================================================================

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        overlay = new TextView(this);
        overlay.setBackgroundColor(0xF0000000);
        overlay.setTextColor(Color.WHITE);
        overlay.setTextSize(28f);
        overlay.setGravity(android.view.Gravity.CENTER);
        overlay.setText(R.string.loading);
        overlay.setPadding(48, 48, 48, 48);

        webView = createWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        initTts();
        applyImmersiveMode();
        resolveAndLoad();
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            if (pageLoaded) {
                evalJs("window.DshTv && window.DshTv.onResume && window.DshTv.onResume()");
            }
        }
    }

    @Override
    protected void onPause() {
        if (webView != null && pageLoaded) {
            evalJs("window.DshTv && window.DshTv.onPause && window.DshTv.onPause()");
        }
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // adb shell am start ... --es url http://... while the app is already running
        String extra = intent != null ? intent.getStringExtra("url") : null;
        if (extra != null && !extra.trim().isEmpty()) {
            urlFromIntent = true;
            failureCount = 0;
            loadUrlWithWatchdog(extra.trim());
        }
    }

    /**
     * Speech-recognizer shell result (RecognizerIntent via startActivityForResult).
     * Reports back to the page as {ok:true,text} or {ok:false,reason}.
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_VOICE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        mainHandler.removeCallbacks(voiceTimeoutRunnable);
        if (!voicePending) {
            // Timeout/no_service already reported; a late UI result must not double-callback.
            Log.i(TAG, "voice: late/duplicate result ignored (requestCode=" + requestCode
                    + ", resultCode=" + resultCode + ")");
            return;
        }
        voicePending = false;

        if (resultCode == RESULT_OK) {
            String text = null;
            try {
                ArrayList<String> results = data != null
                        ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
                if (results != null && !results.isEmpty()) {
                    text = results.get(0);
                }
            } catch (Throwable t) {
                Log.w(TAG, "voice: reading EXTRA_RESULTS failed: " + t);
            }
            if (text == null || text.trim().isEmpty()) {
                Log.i(TAG, "voice: RESULT_OK but empty text -> error");
                callbackVoice(false, null, "error");
            } else {
                Log.i(TAG, "voice: result ok text=" + text);
                callbackVoice(true, text, null);
            }
            return;
        }
        if (resultCode == RESULT_CANCELED) {
            Log.i(TAG, "voice: result cancelled by user");
            callbackVoice(false, null, "cancelled");
            return;
        }
        Log.i(TAG, "voice: unexpected resultCode=" + resultCode);
        callbackVoice(false, null, "error");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Throwable t) {
                Log.w(TAG, "DshTv: tts shutdown failed: " + t);
            }
            tts = null;
            ttsReady = false;
        }
        if (webView != null) {
            try {
                webView.loadUrl("about:blank");
                root.removeView(webView);
                webView.removeJavascriptInterface("DshTvNative");
                webView.stopLoading();
                webView.destroy();
            } catch (Throwable t) {
                Log.w(TAG, "DshTv: webview destroy failed: " + t);
            }
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // Long-running TV session: drop the WebView cache under memory pressure.
        if (level >= TRIM_MEMORY_RUNNING_LOW && webView != null) {
            Log.i(TAG, "DshTv: trim memory level=" + level + ", clearing WebView cache");
            try {
                webView.clearCache(true);
            } catch (Throwable t) {
                Log.w(TAG, "DshTv: clearCache failed: " + t);
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void applyImmersiveMode() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    // =======================================================================
    // URL resolution: intent extra -> SharedPreferences -> UDP -> default
    // =======================================================================

    private void resolveAndLoad() {
        Intent intent = getIntent();
        String extra = intent != null ? intent.getStringExtra("url") : null;
        if (extra != null && !extra.trim().isEmpty()) {
            urlFromIntent = true;
            String url = extra.trim();
            Log.i(TAG, "DshTv: url from intent extra: " + url);
            loadUrlWithWatchdog(url);
            return;
        }

        String saved = readSavedUrl();
        if (saved != null) {
            Log.i(TAG, "DshTv: url from SharedPreferences: " + saved);
            loadUrlWithWatchdog(saved);
            return;
        }

        // Nothing cached: discover on a worker thread (max 1.5 s) to avoid blocking UI.
        showOverlay(getString(R.string.loading));
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String found = discoverUrl();
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        if (found != null) {
                            Log.i(TAG, "DshTv: discovered bridge at " + found);
                            saveUrl(found);
                            loadUrlWithWatchdog(found);
                        } else {
                            Log.i(TAG, "DshTv: discovery found nothing, fallback default " + DEFAULT_URL);
                            loadUrlWithWatchdog(DEFAULT_URL);
                        }
                    }
                });
            }
        }, "tv-udp-discovery").start();
    }

    private void rediscoverThenReload() {
        Log.i(TAG, "DshTv: re-running UDP discovery after " + failureCount + " failures");
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String found = discoverUrl();
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        if (found != null) {
                            Log.i(TAG, "DshTv: rediscovered bridge at " + found);
                            saveUrl(found);
                            loadUrlWithWatchdog(found);
                        } else {
                            loadUrlWithWatchdog(currentUrl != null ? currentUrl : DEFAULT_URL);
                        }
                    }
                });
            }
        }, "tv-udp-rediscovery").start();
    }

    /** Blocking UDP discovery, must run off the main thread. */
    private String discoverUrl() {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(150);
            byte[] req = DISCOVERY_REQUEST.getBytes("US-ASCII");
            for (InetAddress target : discoveryTargets()) {
                try {
                    socket.send(new DatagramPacket(req, req.length, target, DISCOVERY_PORT));
                    Log.i(TAG, "DshTv: discovery probe -> " + target.getHostAddress());
                } catch (IOException e) {
                    Log.w(TAG, "DshTv: discovery send to " + target + " failed: " + e.getMessage());
                }
            }
            long deadline = SystemClock.elapsedRealtime() + DISCOVERY_TIMEOUT_MS;
            byte[] buf = new byte[512];
            while (SystemClock.elapsedRealtime() < deadline) {
                DatagramPacket resp = new DatagramPacket(buf, buf.length);
                try {
                    socket.receive(resp);
                } catch (SocketTimeoutException te) {
                    continue;
                }
                String msg = new String(buf, 0, resp.getLength(), "UTF-8").trim();
                Log.i(TAG, "DshTv: discovery reply from " + resp.getAddress().getHostAddress() + ": " + msg);
                if (msg.startsWith(DISCOVERY_REPLY_PREFIX)) {
                    String url = msg.substring(DISCOVERY_REPLY_PREFIX.length()).trim();
                    if (url.startsWith("http://") || url.startsWith("https://")) {
                        return url;
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: discovery failed: " + t);
        } finally {
            if (socket != null) {
                socket.close();
            }
        }
        return null;
    }

    private List<InetAddress> discoveryTargets() {
        List<InetAddress> targets = new ArrayList<>();
        try {
            targets.add(InetAddress.getByName("255.255.255.255"));
        } catch (Throwable ignore) {
        }
        try {
            // Emulator: 10.0.2.2 is the Mac host, lets discovery work under the AVD NAT.
            targets.add(InetAddress.getByName("10.0.2.2"));
        } catch (Throwable ignore) {
        }
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) {
                    continue;
                }
                for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                    InetAddress broadcast = ia.getBroadcast();
                    if (broadcast != null && !targets.contains(broadcast)) {
                        targets.add(broadcast);
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: could not enumerate interfaces: " + t);
        }
        return targets;
    }

    private String readSavedUrl() {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String url = sp.getString(PREF_KEY, null);
            if (url == null || url.trim().isEmpty()) {
                url = sp.getString(PREF_KEY_ALT, null);
            }
            if (url != null && !url.trim().isEmpty()) {
                return url.trim();
            }
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: read prefs failed: " + t);
        }
        return null;
    }

    private void saveUrl(String url) {
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(PREF_KEY, url)
                    .putString(PREF_KEY_ALT, url)
                    .apply();
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: save prefs failed: " + t);
        }
    }

    // =======================================================================
    // WebView
    // =======================================================================

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createWebView() {
        WebView wv = new WebView(this);
        wv.setBackgroundColor(Color.BLACK);
        wv.setFocusable(true);
        wv.setFocusableInTouchMode(true);

        // Old WebViews on cheap TV boxes struggle with modern JS; surface the version.
        try {
            String ua = WebSettings.getDefaultUserAgent(this);
            Log.i(TAG, "DshTv: WebView UA: " + ua);
            int chromeIdx = ua.indexOf("Chrome/");
            if (chromeIdx >= 0) {
                String ver = ua.substring(chromeIdx + "Chrome/".length());
                int dot = ver.indexOf('.');
                int major = Integer.parseInt(dot > 0 ? ver.substring(0, dot) : ver);
                if (major < 70) {
                    Log.w(TAG, "DshTv: WARNING ancient WebView (Chrome/" + major
                            + ") — page may not render; update Android System WebView");
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: could not read WebView UA: " + t);
        }

        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        wv.addJavascriptInterface(new DshTvNative(), "DshTvNative");
        wv.setWebViewClient(makeWebViewClient());
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.i(TAG, "DshTv console: " + cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                return true;
            }
        });
        return wv;
    }

    /**
     * Base client plus lazily-instantiated subclasses for API 23+/26+ callbacks, so the
     * APK still loads on API 21/22 where WebResourceError / RenderProcessGoneDetail do
     * not exist (avoiding class-verification failures on old TV boxes).
     */
    private WebViewClient makeWebViewClient() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new TvWebViewClient() {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    handleWebResourceError(request, "http-error " + error);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                               WebResourceResponse errorResponse) {
                    if (request != null && request.isForMainFrame()) {
                        Log.w(TAG, "DshTv: HTTP error " + (errorResponse != null ? errorResponse.getStatusCode() : -1)
                                + " for " + request.getUrl());
                        onLoadFailed("http " + (errorResponse != null ? errorResponse.getStatusCode() : -1));
                    }
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    boolean crashed = detail != null && detail.didCrash();
                    Log.e(TAG, "DshTv: render process gone (crashed=" + crashed + "), rebuilding WebView");
                    rebuildWebView();
                    return true; // handled: do NOT let the app crash
                }
            };
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return new TvWebViewClient() {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    handleWebResourceError(request, "http-error " + error);
                }

                @Override
                public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                               WebResourceResponse errorResponse) {
                    if (request != null && request.isForMainFrame()) {
                        onLoadFailed("http " + (errorResponse != null ? errorResponse.getStatusCode() : -1));
                    }
                }
            };
        }
        return new TvWebViewClient();
    }

    private void handleWebResourceError(WebResourceRequest request, String reason) {
        if (request != null && request.isForMainFrame()) {
            Log.w(TAG, "DshTv: main frame error " + reason + " for " + request.getUrl());
            onLoadFailed(reason);
        }
    }

    /** Base WebViewClient: API 21-safe (no API 23+ types in the signature). */
    private class TvWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // Keep everything inside the WebView; only http(s) is allowed.
            return !(url != null && (url.startsWith("http://") || url.startsWith("https://")));
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            pageLoaded = false;
            Log.i(TAG, "DshTv: page started " + url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (loadFailed) {
                // This is WebView's built-in error page, not the office page: keep the
                // native retry overlay up and keep keys disabled.
                Log.w(TAG, "DshTv: page finished but load had failed — keeping retry overlay (" + url + ")");
                pageLoaded = false;
                return;
            }
            pageLoaded = true;
            failureCount = 0;
            retryScheduled = false;
            mainHandler.removeCallbacks(loadTimeoutRunnable);
            mainHandler.removeCallbacks(retryRunnable);
            hideOverlay();
            Log.i(TAG, "DshTv: page finished " + url + " (keys enabled)");
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            super.onReceivedError(view, errorCode, description, failingUrl);
            // Only used on API 21/22 (API 23+ goes through the WebResourceRequest overload).
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                if (failingUrl == null || currentUrl == null || failingUrl.equals(currentUrl)
                        || !pageLoaded) {
                    Log.w(TAG, "DshTv: error " + errorCode + " " + description + " for " + failingUrl);
                    onLoadFailed("error " + errorCode + " " + description);
                }
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            // LAN bridge is plain http; if someone uses https with a self-signed cert,
            // don't hard-fail silently — log and cancel (retry overlay will show).
            Log.w(TAG, "DshTv: ssl error: " + error);
            handler.cancel();
        }
    }

    private void rebuildWebView() {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        pageLoaded = false;
        pageReady = false;
        mainHandler.removeCallbacks(loadTimeoutRunnable);
        showOverlay(getString(R.string.retry_hint));
        WebView old = webView;
        if (old != null) {
            try {
                root.removeView(old);
                old.removeJavascriptInterface("DshTvNative");
                old.destroy();
            } catch (Throwable t) {
                Log.w(TAG, "DshTv: old webview cleanup failed: " + t);
            }
        }
        webView = createWebView();
        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        final String url = currentUrl != null ? currentUrl : DEFAULT_URL;
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                loadUrlWithWatchdog(url);
            }
        }, 1000);
    }

    // =======================================================================
    // Load / retry state machine
    // =======================================================================

    private void loadUrlWithWatchdog(String url) {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        if (url == null || url.isEmpty()) {
            url = DEFAULT_URL;
        }
        currentUrl = url;
        pageLoaded = false;
        loadFailed = false;
        retryScheduled = false;
        mainHandler.removeCallbacks(retryRunnable);
        mainHandler.removeCallbacks(loadTimeoutRunnable);
        showOverlay(getString(R.string.loading));
        Log.i(TAG, "DshTv: loadUrl " + url);
        try {
            webView.loadUrl(url);
        } catch (Throwable t) {
            Log.e(TAG, "DshTv: loadUrl threw: " + t);
            onLoadFailed("load threw: " + t);
            return;
        }
        mainHandler.postDelayed(loadTimeoutRunnable, LOAD_TIMEOUT_MS);
    }

    private void onLoadFailed(String reason) {
        if (isFinishing() || isDestroyed()) {
            return;
        }
        pageLoaded = false;
        loadFailed = true;
        mainHandler.removeCallbacks(loadTimeoutRunnable);
        Log.w(TAG, "DshTv: load failed (" + reason + "), retry in " + RETRY_DELAY_MS + " ms");
        showOverlay(getString(R.string.retry_hint));
        scheduleRetry();
    }

    private void scheduleRetry() {
        if (retryScheduled) {
            return;
        }
        retryScheduled = true;
        mainHandler.postDelayed(retryRunnable, RETRY_DELAY_MS);
    }

    private void showOverlay(String text) {
        if (overlay == null) {
            return;
        }
        overlay.setText(text);
        overlay.setVisibility(View.VISIBLE);
        overlay.bringToFront();
    }

    private void hideOverlay() {
        if (overlay != null) {
            overlay.setVisibility(View.GONE);
        }
    }

    private void evalJs(final String js) {
        final WebView wv = webView;
        if (wv == null) {
            return;
        }
        wv.post(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(js, null);
                } catch (Throwable t) {
                    Log.w(TAG, "DshTv: evaluateJavascript failed: " + t);
                }
            }
        });
    }

    // =======================================================================
    // Remote control keys (CONTRACT §4.2 / §5)
    // =======================================================================

    private static boolean isOkKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER          // 23
                || keyCode == KeyEvent.KEYCODE_ENTER            // 66
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER     // 160
                || keyCode == KeyEvent.KEYCODE_BUTTON_A         // 96  (gamepads)
                || keyCode == KeyEvent.KEYCODE_BUTTON_SELECT;   // 109 (air-mouse remotes)
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        final int code = event.getKeyCode();
        final int action = event.getAction();

        if (isOkKey(code)) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) {
                    okDown = true;
                    longPressFired = false;
                    flagLongPress = false;
                    okDownAt = event.getDownTime();
                    okDownWallClock = SystemClock.uptimeMillis();
                    // Some boxes / adb inject FLAG_LONG_PRESS on the initial down.
                    if ((event.getFlags() & KeyEvent.FLAG_LONG_PRESS) != 0) {
                        flagLongPress = true;
                        Log.i(TAG, "DshTv: FLAG_LONG_PRESS on key down");
                    }
                    event.startTracking();
                    mainHandler.removeCallbacks(longPressRunnable);
                    // Compensate for dispatch lag so the timer still fires ~600 ms after
                    // the *physical* press, not 600 ms after a stalled UI thread woke up.
                    long alreadyHeld = SystemClock.uptimeMillis() - okDownAt;
                    if (alreadyHeld < 0) {
                        alreadyHeld = 0;
                    }
                    mainHandler.postDelayed(longPressRunnable, Math.max(0L, LONG_PRESS_MS - alreadyHeld));
                    return true;
                }
                // Ignore auto-repeat traffic, but the system marks the post-long-press
                // repeat with FLAG_LONG_PRESS: use that as an extra long-press source so
                // remotes that don't report by duration (and `adb input --longpress`)
                // still produce long_ok.
                if ((event.getFlags() & KeyEvent.FLAG_LONG_PRESS) != 0) {
                    if (!flagLongPress) {
                        flagLongPress = true;
                        Log.i(TAG, "DshTv: FLAG_LONG_PRESS on repeat -> long press armed");
                    }
                }
                return true;
            }
            if (action == KeyEvent.ACTION_UP) {
                mainHandler.removeCallbacks(longPressRunnable);
                if (!okDown) {
                    return true; // stray key up (e.g. after focus change)
                }
                // Measure the real hold from the KeyEvent timestamps: wall-clock time
                // between dispatching down/up is unreliable on slow TV boxes (the UI
                // thread may be busy drawing, making a 1 ms tap look like 600+ ms).
                long heldMs = event.getEventTime() - okDownAt;
                if (heldMs < 0 || heldMs > 60_000L) {
                    heldMs = SystemClock.uptimeMillis() - okDownWallClock;
                }
                boolean timerArmed = longPressFired;
                boolean flagged = flagLongPress;
                // Primary: >= 600 ms real hold. Compatibility: system long-press flag
                // (adb input --longpress / remotes that only report via repeat flags).
                boolean wasLong = flagged || heldMs >= LONG_PRESS_MS;
                if (!wasLong && timerArmed) {
                    Log.i(TAG, "DshTv: timer fired but real hold was only " + heldMs
                            + " ms (dispatch lag) -> short press");
                }
                okDown = false;
                longPressFired = false;
                flagLongPress = false;
                Log.i(TAG, "DshTv: key judge held=" + heldMs + " ms flag=" + flagged + " timer=" + timerArmed);
                sendKey(wasLong ? "long_ok" : "ok", heldMs);
                return true;
            }
            return true; // ACTION_MULTIPLE etc.
        }

        if (code == KeyEvent.KEYCODE_BACK) {
            // NEVER finish the activity here: children must not land on the TV launcher.
            if (action == KeyEvent.ACTION_UP) {
                sendKey("back", 0);
            }
            return true;
        }

        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            if (action == KeyEvent.ACTION_UP) {
                sendKey("menu", 0);
            }
            return true;
        }

        if (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN
                || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT) {
            if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                String dir;
                switch (code) {
                    case KeyEvent.KEYCODE_DPAD_UP:
                        dir = "up";
                        break;
                    case KeyEvent.KEYCODE_DPAD_DOWN:
                        dir = "down";
                        break;
                    case KeyEvent.KEYCODE_DPAD_LEFT:
                        dir = "left";
                        break;
                    default:
                        dir = "right";
                        break;
                }
                sendKey(dir, 0);
            }
            return true;
        }

        return super.dispatchKeyEvent(event);
    }

    /** Fallback long-press path (CONTRACT §5) — guarded so it never double-fires. */
    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (isOkKey(keyCode)) {
            if (!longPressFired) {
                longPressFired = true;
                Log.i(TAG, "DshTv: onKeyLongPress fallback fired");
            }
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        // Back always belongs to the page (close panel first), never to the system.
        sendKey("back", 0);
    }

    private void sendKey(String action, long heldMs) {
        if (!pageLoaded) {
            Log.i(TAG, "DshTv: key '" + action + "' dropped (page not ready)");
            return;
        }
        Log.i(TAG, "DshTv: key -> " + action + (heldMs > 0 ? " (held " + heldMs + " ms)" : ""));
        evalJs("window.DshTv && window.DshTv.onKey('" + action + "')");
    }

    // =======================================================================
    // TTS (CONTRACT §5)
    // =======================================================================

    private void initTts() {
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status != TextToSpeech.SUCCESS) {
                        Log.w(TAG, "DshTv: TTS init failed (status=" + status + "), running silently");
                        ttsReady = false;
                        return;
                    }
                    try {
                        int lang = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                        if (lang == TextToSpeech.LANG_MISSING_DATA
                                || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                            Log.w(TAG, "DshTv: Chinese TTS data unavailable (lang=" + lang + ")");
                            ttsReady = false;
                        } else {
                            ttsReady = true;
                            tts.setSpeechRate(0.95f); // whale girl: a bit slower for kids
                            tts.setPitch(1.12f);
                            tts.setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build());
                            Log.i(TAG, "DshTv: TTS ready (zh-CN, rate=0.95, pitch=1.12)");
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "DshTv: TTS setup failed: " + t);
                        ttsReady = false;
                    }
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: TTS unavailable: " + t);
            tts = null;
            ttsReady = false;
        }
    }

    private void speakText(String text) {
        if (text == null || text.trim().isEmpty()) {
            return;
        }
        Log.i(TAG, "DshTv: speak: " + text);
        if (tts == null || !ttsReady) {
            return; // silent failure: never bother the user with a dialog
        }
        try {
            String utteranceId = "dsh-tv-" + utteranceSeq.incrementAndGet();
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
            if (result != TextToSpeech.SUCCESS) {
                Log.w(TAG, "DshTv: tts.speak returned " + result);
            }
        } catch (Throwable t) {
            Log.w(TAG, "DshTv: tts.speak failed: " + t);
        }
    }

    // =======================================================================
    // Voice test: borrow the system speech recognizer via RecognizerIntent
    // (no RECORD_AUDIO permission, no third-party library; CONTRACT §4.1).
    // =======================================================================

    /**
     * Show the system "please speak" UI. On a Chinese TV box there is very often
     * no activity for ACTION_RECOGNIZE_SPEECH (Xiaoai owns the remote mic), which
     * we report as reason=no_service instead of crashing.
     */
    private void beginVoiceTest() {
        Log.i(TAG, "voice: startVoiceTest requested");
        if (isFinishing() || isDestroyed()) {
            Log.i(TAG, "voice: activity finishing, ignored");
            return;
        }
        if (voicePending) {
            Log.i(TAG, "voice: a voice test is already pending, ignored");
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "请对着遥控器说话");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

        // Diagnostic for the real box: does any recognizer activity even exist?
        try {
            ResolveInfo ri = getPackageManager().resolveActivity(intent, 0);
            if (ri != null && ri.activityInfo != null) {
                Log.i(TAG, "voice: recognizer activity = "
                        + ri.activityInfo.packageName + "/" + ri.activityInfo.name);
            } else {
                Log.i(TAG, "voice: recognizer activity = NOT FOUND");
            }
        } catch (Throwable t) {
            Log.w(TAG, "voice: resolveActivity failed: " + t);
        }

        try {
            voicePending = true;
            startActivityForResult(intent, REQ_VOICE);
            Log.i(TAG, "voice: RecognizerIntent launched (startActivityForResult " + REQ_VOICE + ")");
            mainHandler.removeCallbacks(voiceTimeoutRunnable);
            mainHandler.postDelayed(voiceTimeoutRunnable, VOICE_TIMEOUT_MS);
        } catch (ActivityNotFoundException e) {
            // Most likely outcome on a domestic TV box: no system recognizer UI.
            voicePending = false;
            mainHandler.removeCallbacks(voiceTimeoutRunnable);
            Log.i(TAG, "voice: no_service (ActivityNotFoundException: " + e.getMessage() + ")");
            callbackVoice(false, null, "no_service");
        } catch (Throwable t) {
            voicePending = false;
            mainHandler.removeCallbacks(voiceTimeoutRunnable);
            Log.w(TAG, "voice: start failed (" + t + ")");
            callbackVoice(false, null, "error");
        }
    }

    /**
     * Send the result to the page. JSON is built with JSONObject.quote so quotes /
     * backslashes / newlines in the recognized text cannot break the JS call.
     */
    private void callbackVoice(boolean ok, String text, String reason) {
        String json;
        if (ok) {
            json = "{\"ok\":true,\"text\":" + JSONObject.quote(text == null ? "" : text) + "}";
        } else {
            json = "{\"ok\":false,\"reason\":" + JSONObject.quote(reason == null ? "error" : reason) + "}";
        }
        Log.i(TAG, "voice: callback -> " + json);
        if (webView == null) {
            Log.i(TAG, "voice: webview is null, callback dropped (no-op)");
            return;
        }
        if (!pageLoaded || !pageReady) {
            // Still evaluate: the page's window.DshTv guard makes this a safe no-op,
            // and pageLoaded/pageReady may simply be a few ms behind.
            Log.i(TAG, "voice: page not ready (loaded=" + pageLoaded + ", ready=" + pageReady
                    + "), callback is a safe no-op if the page is absent");
        }
        evalJs("window.DshTv && window.DshTv.onVoiceResult(" + json + ")");
    }

    // =======================================================================
    // JS bridge: window.DshTvNative (CONTRACT §4.1)
    // =======================================================================

    public class DshTvNative {
        @JavascriptInterface
        public void ready() {
            pageReady = true;
            Log.i(TAG, "DshTv: native ready() from page");
        }

        /**
         * Tolerance overload: some page wrappers dispatch with an extra undefined arg
         * (`n[fn](arg)` with no arg). Chromium resolves Java bridge calls by argument
         * count, so a 0-arg-only method silently fails there.
         */
        @JavascriptInterface
        public void ready(String ignored) {
            ready();
        }

        @JavascriptInterface
        public void speak(final String text) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    speakText(text);
                }
            });
        }

        @JavascriptInterface
        public void stopSpeak(String ignored) {
            stopSpeak();
        }

        /** Voice test entry point: opens the system speech recognizer UI. */
        @JavascriptInterface
        public void startVoiceTest() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    beginVoiceTest();
                }
            });
        }

        /**
         * Tolerance overload: the page wrapper calls n[fn](arg) with an undefined
         * argument even for 0-arg methods (see CONTRACT / README); Chromium matches
         * Java bridge methods by argument count, so this overload is required.
         */
        @JavascriptInterface
        public void startVoiceTest(String ignored) {
            startVoiceTest();
        }

        @JavascriptInterface
        public void stopSpeak() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    if (tts != null) {
                        try {
                            tts.stop();
                        } catch (Throwable t) {
                            Log.w(TAG, "DshTv: tts.stop failed: " + t);
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void log(String msg) {
            Log.i(TAG, "DshTv: " + msg);
        }

        @JavascriptInterface
        public void exit(String ignored) {
            exit();
        }

        @JavascriptInterface
        public void exit() {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    Log.i(TAG, "DshTv: exit() requested by page");
                    finish();
                }
            });
        }
    }
}
