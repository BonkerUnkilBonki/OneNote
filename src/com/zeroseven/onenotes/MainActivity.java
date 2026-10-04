package com.zeroseven.onenotes;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    private WebView web;
    private static final int REQ_IMPORT = 41;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        web.setBackgroundColor(0xFFF2F4F7);
        web.loadUrl("file:///android_asset/index.html");
    }

    /** JS bridge: storage, settings, sync, export/import. */
    private class Bridge {
        @JavascriptInterface
        public String getNotes() {
            return Store.readNotes(MainActivity.this);
        }

        @JavascriptInterface
        public void saveNotes(String json) {
            Store.writeNotes(MainActivity.this, json);
        }

        @JavascriptInterface
        public String getSettings() {
            return Store.allSettingsJson(MainActivity.this);
        }

        @JavascriptInterface
        public void setSetting(String k, String v) {
            Store.setPref(MainActivity.this, k, v);
        }

        @JavascriptInterface
        public String getSystemTheme() {
            int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return m == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
        }

        @JavascriptInterface
        public void toast(final String m) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, m, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void sync() {
            WebDavSync.Callback cb = (ok, msg) -> runOnUiThread(() ->
                    web.evaluateJavascript(
                            "window.onSyncResult && window.onSyncResult("
                                    + JSONObject.quote((ok ? "ok|" : "err|") + msg) + ")",
                            null));
            String provider = Store.pref(MainActivity.this, "sync_provider", "github");
            if ("webdav".equals(provider)) WebDavSync.start(MainActivity.this, cb);
            else GitHubSync.start(MainActivity.this, cb);
        }

        @JavascriptInterface
        public void shareText(String subject, String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(i, "Share note"));
        }

        @JavascriptInterface
        public void exportNotes(String json) {
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME,
                            "onenotes-backup-" + System.currentTimeMillis() + ".json");
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri != null) {
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            os.write(json.getBytes(StandardCharsets.UTF_8));
                        }
                        toastOnUiThread("Backup saved to Downloads");
                        return;
                    }
                } catch (Exception ignored) {
                    // fall back to share sheet
                }
            }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, json);
            startActivity(Intent.createChooser(i, "Share notes backup"));
        }

        @JavascriptInterface
        public void importPick() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, REQ_IMPORT);
            });
        }
    }

    private void toastOnUiThread(String m) {
        runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT && resultCode == RESULT_OK
                && data != null && data.getData() != null) {
            try {
                InputStream in = getContentResolver().openInputStream(data.getData());
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(
                        new InputStreamReader(in, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line).append('\n');
                }
                final String payload = sb.toString();
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.importNotes && window.importNotes("
                                + JSONObject.quote(payload) + ")", null));
            } catch (Exception e) {
                toastOnUiThread("Could not read that file");
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.handleBack ? window.handleBack() : 'exit'",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (v == null || v.contains("exit")) finish();
                    }
                });
    }
}
