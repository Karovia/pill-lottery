#!/usr/bin/env bash
# 把本仓库打包成 macOS 原生 App（WKWebView 壳，双击即开，无需服务器）
# 用法：在本仓库根目录执行  bash macos-app/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="吃药大转盘.app"
SWIFT="/usr/bin/swiftc"
command -v "$SWIFT" >/dev/null 2>&1 || SWIFT=swiftc

rm -rf "$APP_NAME" app-build
mkdir -p "$APP_NAME/Contents/MacOS" "$APP_NAME/Contents/Resources"

# 网页资源整体打进包内
cp -R index.html css js assets "$APP_NAME/Contents/Resources/"

# 编译壳
$SWIFT -swift-version 5 -O macos-app/main.swift \
  -o "$APP_NAME/Contents/MacOS/PillLottery" \
  -framework Cocoa -framework WebKit

cp macos-app/Info.plist "$APP_NAME/Contents/Info.plist"

# 图标（可选）：由恐龙精灵图生成
if command -v ffmpeg >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  mkdir -p /tmp/pl.iconset
  ffmpeg -y -loglevel error -i assets/sprites/dino_stand.png \
    -vf "scale=440:470:flags=neighbor,pad=512:512:36:21:#f7f7f7" /tmp/pl_512.png
  for s in 16 32 128 256 512; do
    ffmpeg -y -loglevel error -i /tmp/pl_512.png -vf "scale=${s}:${s}:flags=neighbor" "/tmp/pl.iconset/icon_${s}x${s}.png"
    ffmpeg -y -loglevel error -i /tmp/pl_512.png -vf "scale=$((s*2)):$((s*2)):flags=neighbor" "/tmp/pl.iconset/icon_${s}x${s}@2x.png"
  done
  iconutil -c icns /tmp/pl.iconset -o "$APP_NAME/Contents/Resources/AppIcon.icns" || true
fi

codesign --force -s - "$APP_NAME" 2>/dev/null || true
echo "完成：$APP_NAME（双击打开；进度存于 WKWebView localStorage）"
