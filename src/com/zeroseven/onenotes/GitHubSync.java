package com.zeroseven.onenotes;

import android.content.Context;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Syncs notes with onenotes.json in a private GitHub repo via the Contents API.
 * Token: fine-grained or classic PAT with Contents: Read and write on the repo.
 */
public class GitHubSync {

    private static final String API = "https://api.github.com";

    static void start(final Context ctx, final WebDavSync.Callback cb) {
        new Thread(() -> {
            String token = Store.pref(ctx, "gh_token", "").trim();
            String repo = Store.pref(ctx, "gh_repo", "gitnotes-sync").trim();
            if (repo.isEmpty()) repo = "gitnotes-sync";
            if (token.isEmpty()) {
                cb.done(false, "Add a GitHub token in Settings first");
                return;
            }
            try {
                String owner = Store.pref(ctx, "gh_user", "");
                if (owner.isEmpty()) {
                    owner = fetchLogin(token);
                    if (owner == null) {
                        cb.done(false, "Token rejected by GitHub \u2014 check it and try again");
                        return;
                    }
                    Store.setPref(ctx, "gh_user", owner);
                }

                int repoCode = repoInfo(owner, repo, token);
                if (repoCode == 404) {
                    /* owner may be stale (different account's token) — refresh once */
                    String fresh = fetchLogin(token);
                    if (fresh != null && !fresh.equals(owner)) {
                        owner = fresh;
                        Store.setPref(ctx, "gh_user", owner);
                        repoCode = repoInfo(owner, repo, token);
                    }
                }
                if (repoCode == 401 || repoCode == 403) {
                    cb.done(false, "Token has no access \u2014 include " + repo + " in its Repository access");
                    return;
                }
                if (repoCode == 404) {
                    cb.done(false, "Repo " + repo + " not found \u2014 create it on GitHub first (private, no README)");
                    return;
                }
                if (repoCode / 100 != 2) {
                    cb.done(false, "GitHub error (HTTP " + repoCode + ")");
                    return;
                }

                String[] remote = fetchFile(owner, repo, token); // {content, sha} or null
                String local = Store.readNotes(ctx);
                String merged = (remote != null) ? WebDavSync.merge(remote[0], local) : local;

                int code = pushFile(owner, repo, merged, remote == null ? null : remote[1], token);
                if (code == 409) {
                    cb.done(false, "Remote changed \u2014 pull to refresh again");
                    return;
                }
                if (code == 401 || code == 403) {
                    cb.done(false, "Token rejected \u2014 it needs Contents: Read and write on " + repo);
                    return;
                }
                if (code != 200 && code != 201) {
                    cb.done(false, "Upload failed (HTTP " + code + ")");
                    return;
                }
                Store.writeNotes(ctx, merged);
                int count = WebDavSync.countAlive(merged);
                cb.done(true, count + (count == 1 ? " note synced" : " notes synced"));
            } catch (Exception e) {
                String m = e.getMessage();
                cb.done(false, m == null ? "Sync failed" : m);
            }
        }, "github-sync").start();
    }

    private static HttpURLConnection open(String u, String token, String method) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(25000);
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", "OneNotes-Android");
        if (method != null) c.setRequestMethod(method);
        return c;
    }

    private static String fetchLogin(String token) throws Exception {
        HttpURLConnection c = open(API + "/user", token, "GET");
        try {
            if (c.getResponseCode() / 100 != 2) return null;
            return new JSONObject(readStream(c.getInputStream())).getString("login");
        } finally {
            c.disconnect();
        }
    }

    private static int repoInfo(String owner, String repo, String token) throws Exception {
        HttpURLConnection c = open(API + "/repos/" + owner + "/" + repo, token, "GET");
        try {
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    /** Returns {decodedContent, sha}, or null if the file doesn't exist yet. */
    private static String[] fetchFile(String owner, String repo, String token) throws Exception {
        HttpURLConnection c = open(API + "/repos/" + owner + "/" + repo
                + "/contents/onenotes.json", token, "GET");
        try {
            int code = c.getResponseCode();
            if (code == 404) return null;
            if (code / 100 != 2) throw new Exception("GitHub error (HTTP " + code + ")");
            JSONObject o = new JSONObject(readStream(c.getInputStream()));
            String b64 = o.getString("content").replaceAll("\\s", "");
            String sha = o.getString("sha");
            return new String[]{new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8), sha};
        } finally {
            c.disconnect();
        }
    }

    private static int pushFile(String owner, String repo, String content, String sha, String token)
            throws Exception {
        HttpURLConnection c = open(API + "/repos/" + owner + "/" + repo
                + "/contents/onenotes.json", token, "PUT");
        try {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            JSONObject body = new JSONObject();
            body.put("message", "OneNotes sync \u2014 " + Build.MODEL);
            body.put("content", Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8)));
            if (sha != null) body.put("sha", sha);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private static String readStream(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return new String(bo.toByteArray(), StandardCharsets.UTF_8);
    }
}
