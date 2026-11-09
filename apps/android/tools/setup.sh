#!/bin/bash
# Fetch the build tools used by build.sh (no Android SDK / Gradle needed):
#   aapt2 (npm: aaptjs3), apksigner (npm: @postar/apktool-node), dx (dex2jar release),
#   android.jar (API 34), sherpa-onnx prebuilt JNI libraries (arm64-v8a)
set -e
cd "$(dirname "$0")"
SHERPA=v2.0.1
npm pack aaptjs3@2.0.2 --silent && tar xzf aaptjs3-2.0.2.tgz && rm -rf aaptjs3 && mv package aaptjs3 && chmod +x aaptjs3/bin/x64/linux/aapt2
npm pack @postar/apktool-node@0.3.4 --silent && tar xzf postar-apktool-node-0.3.4.tgz && rm -rf apktool-node && mv package apktool-node
curl -sSL -o d2j.zip https://github.com/pxb1988/dex2jar/releases/download/v2.4/dex-tools-v2.4.zip && unzip -q -o d2j.zip 'dex-tools-v2.4/lib/dx-30.0.2.jar'
curl -sSL -o android.jar https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
curl -sSL -o so.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/$SHERPA/sherpa-onnx-$SHERPA-android.tar.bz2
tar xjf so.tar.bz2 './jniLibs/arm64-v8a/libsherpa-onnx-jni.so' './jniLibs/arm64-v8a/libonnxruntime.so'
rm -f *.tgz d2j.zip so.tar.bz2
echo "tools ready"
