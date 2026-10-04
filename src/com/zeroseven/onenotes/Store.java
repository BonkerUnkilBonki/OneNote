package com.zeroseven.onenotes;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/** Local persistence: notes JSON file + SharedPreferences. */
public class Store {

    private static final String PREFS = "onenotes_prefs";

    static File notesFile(Context c) {
        return new File(c.getFilesDir(), "notes.json");
    }

    static String readNotes(Context c) {
        try {
            File f = notesFile(c);
            if (!f.exists()) return "[]";
            StringBuilder sb = new StringBuilder();
            try (InputStreamReader r = new InputStreamReader(
                    new FileInputStream(f), StandardCharsets.UTF_8)) {
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
            }
            return sb.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    static void writeNotes(Context c, String json) {
        try {
            File tmp = new File(c.getFilesDir(), "notes.json.tmp");
            try (OutputStreamWriter w = new OutputStreamWriter(
                    new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
                w.write(json);
            }
            File dst = notesFile(c);
            if (dst.exists()) dst.delete();
            tmp.renameTo(dst);
        } catch (Exception ignored) {
        }
    }

    static String pref(Context c, String key, String def) {
        return prefs(c).getString(key, def);
    }

    static void setPref(Context c, String key, String val) {
        prefs(c).edit().putString(key, val).apply();
    }

    static String allSettingsJson(Context c) {
        SharedPreferences p = prefs(c);
        org.json.JSONObject o = new org.json.JSONObject();
        try {
            for (String k : p.getAll().keySet()) {
                Object v = p.getAll().get(k);
                o.put(k, v == null ? "" : String.valueOf(v));
            }
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
