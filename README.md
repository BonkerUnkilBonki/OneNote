# OneNotes

A Samsung One UI-styled notes app for Android with cross-device sync over WebDAV.

## Features

- One UI design language: big bold header titles, floating glassy pill navigation bar, squircle FAB, rounded cards (24px+ radii), Samsung-blue accent, One UI switches and segmented controls, bottom sheets with drag handles, ripple effects, undo snackbar
- Light / Dark / Pitch black (AMOLED) / System theme
- Pin, favourite, colour (13 One UI pastel tints) and icon (36 emoji) your notes
- Notion-style blocks: type `/` for tasks, headings, lists, quotes and dividers, or use the format toolbar above the keyboard
- Superlist-style **Tasks tab**: every checkbox from every note, grouped into Today / Upcoming / Anytime, with one-tap check-off and due dates (`@today`, `@tomorrow`, `@2026-09-30`)
- Task progress bars and `#tags` on note cards
- Note view (rendered page): headings, interactive checklists, bullets, quotes, callouts, dividers, code blocks, tables, [[note links]], inline bold/italic/strike/code, #tags, and a footer with created/edited dates, word and task counts
- Covers: 8 gradient covers and 36 emoji icons for every note
- Trash bin: restore or delete-forever deleted notes, with empty-trash (deletions still propagate via sync tombstones)
- Grid / list view toggle for the notes list, and Share note (Android share sheet)
- Templates (to-do, shopping, meeting notes, journal, project plan), duplicate note, sort options, live word count
- Rich One UI motion: staggered card entrances, depth screen transitions, springy sheets, star pop, FAB spin-in, toast bounce, smooth theme crossfade
- **GitHub sync**: notes sync to your private `gitnotes-sync` repo via a personal access token — one-time setup, then pull-to-refresh on any device
- WebDAV sync as an alternative provider (same merge rules)
- Pull-to-refresh on the notes list triggers sync
- Instant search, All notes / Favourites filter
- Autosave editor
- Sync across devices: one `onenotes.json` file, per-note last-write-wins merge, deletion tombstones
- Export / import JSON backups

## Install (testing)

`OneNotes.apk` is signed with the included self-signed key. Copy it to your phone and open it, then allow "Install unknown apps" for your browser/file manager when prompted. Min Android 8.0 (API 26).

## Setting up sync (GitHub — recommended)

1. On github.com: create a **private** repo named `gitnotes-sync` (no README needed).
2. Create a fine-grained (or classic) token, include `gitnotes-sync` in its Repository access, and give it **Contents: Read and write**.
3. In the app: Settings > Sync > paste the token (repo name defaults to `gitnotes-sync`).
4. Pull down on the notes list to sync. Use the same account on every device.

Your notes are stored as a single `onenotes.json` file in that repo. Merge is per-note, newest edit wins — avoid editing the same note on two devices simultaneously. The token lives only in your device's app-private storage and is sent only to api.github.com.

### WebDAV alternative

Settings > Sync > provider > WebDAV, then enter server / username / password (Koofr, TeraCloud, Nextcloud...). Same merge rules.

## Rebuilding

No Gradle needed. Requirements on the build machine:

- JDK 17 (Temurin), Android build-tools 34, platform android-34

Edit `build.sh` so `SDK` points to a directory laid out as:

```
sdk/jdk/                    # extracted JDK 17
sdk/bt/android-14/          # extracted build-tools_r34 zip
sdk/platform/android-34/    # extracted platform-34 zip (contains android.jar)
```

Then run `bash build.sh`. Output: `OneNotes.apk`.

## Project structure

```
AndroidManifest.xml
assets/            app.css, app.js, index.html   (the whole One UI frontend)
src/…/MainActivity.java   WebView shell + JS bridge
src/…/Store.java          local storage (notes.json + SharedPreferences)
src/…/WebDavSync.java     GET/PUT + merge engine
res/                      launcher icons, themes (light/dark)
gen_icons.py              regenerates launcher icons (Pillow)
build.sh                  full no-Gradle build pipeline
onenotes.keystore         signing key (storepass onenotes123) — regenerate before any real distribution
```

## Before publishing anywhere

Generate your own keystore (the bundled one is for testing only) and enable HTTPS-only WebDAV (`usesCleartextTraffic` is currently true to allow http LAN servers).
