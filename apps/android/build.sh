#!/bin/bash
# Gradle-free APK build: aapt2 -> javac (Java 8) -> dx -> package -> align -> sign
set -e
cd "$(dirname "$0")"
T=$PWD/tools; A=$T/aaptjs3/bin/x64/linux/aapt2; AJ=$T/android.jar
rm -rf build && mkdir -p build/gen build/cls build/res
$A compile --dir app/res -o build/res.zip
$A link -I $AJ --manifest app/AndroidManifest.xml -A app/assets -o build/base.apk build/res.zip --java build/gen --min-sdk-version 29 --target-sdk-version 34 -0 onnx
javac -nowarn -encoding UTF-8 -source 8 -target 8 -bootclasspath $AJ -d build/cls $(find app/src build/gen -name '*.java') 2>&1 | grep -v "Picked up\|warning: \[options\]\|^Note:\|^[0-9] warning" || true
java -jar $T/dex-tools-v2.4/lib/dx-30.0.2.jar --dex --min-sdk-version=26 --output=build/classes.dex build/cls 2>&1 | grep -v "Picked up" || true
cp build/base.apk build/unsigned.apk
(cd build && zip -q unsigned.apk classes.dex)
mkdir -p build/lib/arm64-v8a
cp $T/jniLibs/arm64-v8a/libsherpa-onnx-jni.so $T/jniLibs/arm64-v8a/libonnxruntime.so build/lib/arm64-v8a/
(cd build && zip -q -r unsigned.apk lib)
python3 $T/zipalign.py build/unsigned.apk build/aligned.apk
[ -f tools/release.ks ] || keytool -genkeypair -keystore tools/release.ks -storepass livesub -keypass livesub -alias livesub -keyalg RSA -keysize 2048 -validity 20000 -dname "CN=LiveSub" 2>&1 | grep -v "Picked up"
java -jar $T/apktool-node/lib/apksigner.jar sign --ks tools/release.ks --ks-pass pass:livesub --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out build/LiveSub.apk build/aligned.apk 2>&1 | grep -v "Picked up" || true
ls -la build/LiveSub.apk
