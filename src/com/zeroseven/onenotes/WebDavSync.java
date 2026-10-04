package com.zeroseven.onenotes;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Syncs notes with a single onenotes.json file on any WebDAV server.
 * Merge strategy: per-note last-write-wins on updatedAt; deletions are
 * tombstoned so they propagate to other devices; old tombstones are pruned.
 */
public class WebDavSync {

    interface Callback {
        void done(boolean ok, String message);
    }

    static void start(final Context ctx, final Callback cb) {
        new Thread(() -> {
            String url = Store.pref(ctx, "webdav_url", "").trim();
            String user = Store.pref(ctx, "webdav_user", "");
            String pass = Store.pref(ctx, "webdav_pass", "");
            if (url.isEmpty()) {
                cb.done(false, "Add a WebDAV server in Settings first");
                return;
            }
            if (!url.endsWith("/")) url += "/";
            String remote = url + "onenotes.json";
            try {
                String local = Store.readNotes(ctx);
                String remoteJson = httpGet(remote, user, pass); // null if 404
                String merged = (remoteJson != null) ? merge(remoteJson, local) : local;
                int code = httpPut(remote, merged, user, pass);
                if (code / 100 != 2) {
                    cb.done(false, "Server rejected upload (HTTP " + code + ")");
                    return;
                }
                Store.writeNotes(ctx, merged);
                int count = countAlive(merged);
                cb.done(true, count + (count == 1 ? " note synced" : " notes synced"));
            } catch (Exception e) {
                String m = e.getMessage();
                cb.done(false, m == null ? "Sync failed" : m);
            }
        }, "webdav-sync").start();
    }

    static int countAlive(String json) {
        try {
            JSONArray a = new JSONArray(json);
            int n = 0;
            for (int i = 0; i < a.length(); i++) {
                if (!a.getJSONObject(i).optBoolean("deleted", false)) n++;
            }
            return n;
        } catch (Exception e) {
            return 0;
        }
    }

    static String merge(String remoteJson, String localJson) throws Exception {
        JSONArray remote = new JSONArray(remoteJson);
        JSONArray local = new JSONArray(localJson);
        Map<String, JSONObject> byId = new HashMap<>();
        for (int i = 0; i < remote.length(); i++) {
            JSONObject o = remote.getJSONObject(i);
            byId.put(o.getString("id"), o);
        }
        for (int i = 0; i < local.length(); i++) {
            JSONObject l = local.getJSONObject(i);
            String id = l.getString("id");
            JSONObject r = byId.get(id);
            if (r == null || l.optLong("updatedAt", 0) > r.optLong("updatedAt", 0)) {
                byId.put(id, l);
            }
        }
        JSONArray out = new JSONArray();
        long cutoff = System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000;
        for (JSONObject o : byId.values()) {
            if (o.optBoolean("deleted", false) && o.optLong("updatedAt", 0) < cutoff) continue;
            out.put(o);
        }
        return out.toString();
    }

    private static HttpURLConnection open(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        return c;
    }

    private static String httpGet(String u, String user, String pass) throws Exception {
        HttpURLConnection c = open(u);
        try {
            if (!user.isEmpty()) c.setRequestProperty("Authorization", basic(user, pass));
            int code = c.getResponseCode();
            if (code == 404) return null;
            if (code / 100 != 2) throw new Exception("HTTP " + code);
            return readStream(c.getInputStream());
        } finally {
            c.disconnect();
        }
    }

    private static int httpPut(String u, String body, String user, String pass) throws Exception {
        HttpURLConnection c = open(u);
        try {
            c.setRequestMethod("PUT");
            c.setDoOutput(true);
            if (!user.isEmpty()) c.setRequestProperty("Authorization", basic(user, pass));
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private static String basic(String u, String p) {
        return "Basic " + Base64.getEncoder()
                .encodeToString((u + ":" + p).getBytes(StandardCharsets.UTF_8));
    }

    private static String readStream(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }
}
