#!/usr/bin/env bash
# DSH Office TV — APK acceptance helper.
#
# Usage:
#   ./verify.sh                       # build + install + key/back/long-press checks against
#                                     # http://10.0.2.2:8765/tv (the real Mac bridge)
#   TEST_URL=http://10.0.2.2:8770/index.html ./verify.sh   # against the bundled test page
#
# Prerequisites: ANDROID_HOME set (or SDK at ~/Library/Android/sdk), one device/emulator
# online (`adb devices`), and for TEST_URL 8770 the test page server running:
#   (cd testpage && python3 -m http.server 8770 --bind 0.0.0.0)
set -uo pipefail

APP_ID="dev.dsh.office.tv"
ACTIVITY="$APP_ID/.MainActivity"
APK="app/build/outputs/apk/debug/app-debug.apk"
TEST_URL="${TEST_URL:-http://10.0.2.2:8765/tv}"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
pass=0; fail=0
check() { # check <label> <expected-substring> <actual>
  if printf '%s' "$3" | grep -qF -- "$2"; then
    printf '  \033[32mPASS\033[0m %s  (saw: %s)\n' "$1" "$2"; pass=$((pass + 1))
  else
    printf '  \033[31mFAIL\033[0m %s  (expected: %s, got: %s)\n' "$1" "$2" "$3"; fail=$((fail + 1))
  fi
}

cd "$(dirname "$0")"

say "1. build"
./gradlew assembleDebug 2>&1 | tail -3 || { echo "BUILD FAILED"; exit 1; }
ls -l "$APK"

say "2. install + launch ($TEST_URL)"
adb install -r "$APK" >/dev/null || { echo "INSTALL FAILED"; exit 1; }
adb shell am force-stop "$APP_ID"
adb logcat -c
adb shell am start -n "$ACTIVITY" --es url "$TEST_URL" >/dev/null
sleep 5

# helper: clear log, send keys, wait, return matched DshTv log lines
keys() {
  adb logcat -c; sleep 0.15
  adb shell input "$@" >/dev/null
  sleep 0.9
  adb logcat -d -s DshTv:* | sed 's/^.*DshTv   : //'
}

say "3. page loaded / TTS ready"
startup="$(adb logcat -d -s DshTv:* | sed 's/^.*DshTv   : //')"
check "page finished (keys enabled)" "page finished" "$startup"
check "TTS init zh-CN" "TTS ready" "$startup"

say "4. short OK -> ok"
out="$(keys keyevent 23)"
check "short OK fires ok" "key -> ok" "$out"

say "5. 900 ms hold -> long_ok"
out="$(keys keyevent --duration 900 23)"
check "900ms hold fires long_ok" "key -> long_ok" "$out"

say "6. adb --longpress 23 -> long_ok (opens chat panel)"
out="$(keys keyevent --longpress 23)"
check "adb --longpress fires long_ok" "key -> long_ok" "$out"

say "7. BACK -> back, app stays alive"
out="$(keys keyevent 4)"
check "BACK fires back" "key -> back" "$out"
top="$(adb shell dumpsys activity activities 2>/dev/null | grep -m1 topResumedActivity || true)"
check "app still foreground after BACK" "$APP_ID" "$top"

say "8. dpad / menu / alt OK keycodes"
out="$(keys keyevent 19; keys keyevent 20; keys keyevent 21; keys keyevent 22)"
check "dpad directions forwarded" "key -> up" "$out"
out="$(keys keyevent 82)"
check "menu forwarded" "key -> menu" "$out"
out="$(keys keyevent 96)"   # BUTTON_A
check "BUTTON_A(96) -> ok" "key -> ok" "$out"
out="$(keys keyevent 109)"  # BUTTON_SELECT
check "BUTTON_SELECT(109) -> ok" "key -> ok" "$out"

say "9. result"
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
