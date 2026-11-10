#!/usr/bin/env bash
# 把 Android TV APK 装到已连接的电视盒子 / 模拟器，并可选地指定 bridge 地址启动。
#
# 用法：
#   tools/install-apk.sh                                   # 装默认 debug APK
#   tools/install-apk.sh path/to/app-debug.apk             # 装指定 APK
#   tools/install-apk.sh --url http://192.168.1.23:8765/tv # 装完用指定地址启动
#   tools/install-apk.sh --launch                          # 装完按默认逻辑启动（UDP 发现）
#
# 端口/地址规则见 CONTRACT.md 第 5 节：优先 --es url，其次 SharedPreferences("tv_url")，其次 UDP 发现。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$ROOT/tv-app/app/build/outputs/apk/debug/app-debug.apk"
URL=""
LAUNCH=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --launch)
      LAUNCH=1
      shift
      ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      APK="$1"
      shift
      ;;
  esac
done

# --- 找 adb ---------------------------------------------------------------
ADB_BIN="${ADB:-}"
if [ -z "$ADB_BIN" ]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  else
    for candidate in \
      "${ANDROID_HOME:-}/platform-tools/adb" \
      "${ANDROID_SDK_ROOT:-}/platform-tools/adb" \
      "$HOME/Library/Android/sdk/platform-tools/adb" \
      "/opt/homebrew/bin/adb" \
      "/usr/local/bin/adb"; do
      if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        ADB_BIN="$candidate"
        break
      fi
    done
  fi
fi
if [ -z "$ADB_BIN" ] || [ ! -x "$ADB_BIN" ]; then
  echo "[install] 找不到 adb。请安装 Android SDK platform-tools，或设置 ADB=/path/to/adb" >&2
  exit 1
fi

if [ ! -f "$APK" ]; then
  echo "[install] 找不到 APK：$APK" >&2
  echo "[install] 先构建：cd \"$ROOT/tv-app\" && ./gradlew assembleDebug" >&2
  exit 1
fi

echo "[install] adb：$ADB_BIN"
echo "[install] APK：$APK"

echo "[install] 已连接设备："
"$ADB_BIN" devices -l || true
if ! "$ADB_BIN" get-state >/dev/null 2>&1; then
  echo "[install] 没有在线设备。请先启动电视盒子/模拟器（adb connect <ip>:5555 或启动 AVD）" >&2
  exit 1
fi

echo "[install] 安装中（-r 覆盖安装）…"
"$ADB_BIN" install -r "$APK"

if [ -n "$URL" ]; then
  echo "[install] 用指定地址启动：$URL"
  "$ADB_BIN" shell am start -n dev.dsh.office.tv/.MainActivity --es url "$URL"
elif [ "$LAUNCH" -eq 1 ]; then
  echo "[install] 启动 App（由 App 自己 UDP 发现 bridge）"
  "$ADB_BIN" shell am start -n dev.dsh.office.tv/.MainActivity
else
  echo "[install] 完成。启动方式示例："
  echo "  $ADB_BIN shell am start -n dev.dsh.office.tv/.MainActivity"
  echo "  $ADB_BIN shell am start -n dev.dsh.office.tv/.MainActivity --es url http://<mac-ip>:8765/tv"
fi
