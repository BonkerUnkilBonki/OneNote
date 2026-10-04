#!/usr/bin/env bash
# Build OneNotes.apk without Gradle — aapt2 + javac + d8 + zipalign + apksigner
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK=/scratch/work/sdk
JDK=$SDK/jdk
BT=$SDK/bt/android-14
AJ=$SDK/platform/android-34/android.jar

export JAVA_HOME=$JDK
export PATH=$JDK/bin:$PATH
export _JAVA_OPTIONS="-XX:+UseSerialGC -Xmx128m -Xss512k -XX:CICompilerCount=2 -XX:CompressedClassSpaceSize=32m -XX:MaxMetaspaceSize=96m -XX:ReservedCodeCacheSize=32m -XX:-TieredCompilation -Xshare:off"

BUILD=$ROOT/build
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

echo "== 1. compile resources =="
"$BT/aapt2" compile --dir "$ROOT/res" -o "$BUILD/res.zip"

echo "== 2. link resources =="
"$BT/aapt2" link -o "$BUILD/base.apk" \
  -I "$AJ" \
  --manifest "$ROOT/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  -A "$ROOT/assets" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code 5 \
  --version-name 1.4 \
  "$BUILD/res.zip"

echo "== 3. javac =="
find "$ROOT/src" -name '*.java' > "$BUILD/sources.txt"
find "$BUILD/gen" -name '*.java' >> "$BUILD/sources.txt"
javac -classpath "$AJ" -source 1.8 -target 1.8 -d "$BUILD/classes" @"$BUILD/sources.txt" 2>&1 | grep -v -e '^warning' -e 'warning:' -e '^Note' -e '^1 warning' || true
test -f "$BUILD/classes/com/zeroseven/onenotes/MainActivity.class"

echo "== 4. dex =="
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$AJ" --min-api 26 --output "$BUILD/dex" \
  $(find "$BUILD/classes" -name '*.class')

echo "== 5. package =="
(cd "$BUILD/dex" && zip -q "$BUILD/base.apk" classes.dex)

echo "== 6. zipalign =="
"$BT/zipalign" -f 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

echo "== 7. keystore =="
if [ ! -f "$ROOT/onenotes.keystore" ]; then
  keytool -genkeypair -keystore "$ROOT/onenotes.keystore" -alias onenotes \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass onenotes123 -keypass onenotes123 \
    -dname "CN=OneNotes, O=ZeroSeven, C=IN"
fi

echo "== 8. sign =="
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$ROOT/onenotes.keystore" \
  --ks-pass pass:onenotes123 --key-pass pass:onenotes123 \
  --ks-key-alias onenotes \
  --out "$ROOT/OneNotes.apk" "$BUILD/aligned.apk"

echo "== 9. verify =="
java -jar "$BT/lib/apksigner.jar" verify --print-certs "$ROOT/OneNotes.apk" | head -4
unzip -l "$ROOT/OneNotes.apk" | tail -4
ls -la "$ROOT/OneNotes.apk"
echo "BUILD OK"
