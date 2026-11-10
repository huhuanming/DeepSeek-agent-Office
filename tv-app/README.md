# DSH Office TV — Android TV APK（瘦客户端）

全屏 WebView 打开 Mac 上的办公室页面（`http://<mac-ip>:8765/tv`），负责遥控按键、长按 OK、
中文 TTS、保持常亮、断网自动重试。接口契约见上级目录 `CONTRACT.md`（v1，冻结）。

- **包名**：`dev.dsh.office.tv`；**应用名**：`DSH 办公室`
- **minSdk 21 / targetSdk 34 / compileSdk 35**（`aapt2 dump badging` 已核对）
- **权限**：仅 `INTERNET` + `ACCESS_NETWORK_STATE`
- 同时注册 `LAUNCHER` + `LEANBACK_LAUNCHER`（国产盒子桌面 / Leanback 桌面都能起）
- 语言：Java 17，**零第三方依赖**（无 Kotlin / 无 androidx），APK ≈ 68 KB，构建可离线复现
- 构建组合：**Gradle 9.0.0 + AGP 8.13.2 + JDK 17**（用本机已有 Gradle 9.0.0 缓存）

## 目录

```
tv-app/
├── gradlew                  # 本地 Gradle 启动器（见下方“构建”说明）
├── settings.gradle / build.gradle / gradle.properties
├── debug.keystore           # 项目内 debug 签名（沙箱内 $HOME/.android 不可写 → 不用默认 keystore）
├── verify.sh                # 一键验收：构建+安装+按键断言（11 项）
├── app/src/main/java/dev/dsh/office/tv/MainActivity.java   # 全部客户端逻辑
├── app/src/main/res/        # 图标 / TV banner(640x360) / 字符串 / 全屏主题
├── testpage/index.html      # 按键链路自测页（网页未上线/改造时用）
└── assets/                  # 验收截图（1920x1080）
```

## 构建

```bash
cd tv-app
./gradlew clean assembleDebug
# BUILD SUCCESSFUL in 835ms
# 35 actionable tasks: 35 executed
ls -l app/build/outputs/apk/debug/app-debug.apk
# 69179 bytes  app/build/outputs/apk/debug/app-debug.apk  (含语音测试按钮)
# sha256 644f00b8f043ee3c105fa14700ba411fc1f8d9b1985e68113fcfa01ff0ebb548
```

说明：
- `gradlew` 不是标准 wrapper（不联网下载发行版），会按顺序查找本机已有的
  `~/.gradle/wrapper/dists/gradle-9.0.0-bin/*/gradle-9.0.0/bin/gradle`、`9.4.1`，找不到再退化到 PATH 里的 `gradle`。
  换 Gradle：`DSH_GRADLE_BIN=/path/to/gradle ./gradlew assembleDebug`。
- DSH 沙箱下 `$HOME/.gradle` 可能不可写，`gradlew` 自动把 `GRADLE_USER_HOME` 回退到
  `/tmp/dsh-gradle-home`（也可显式 `DSH_GRADLE_USER_HOME=...`）。
- debug 签名使用仓库内 `debug.keystore`（AGP 默认会写 `$HOME/.android/debug.keystore`，沙箱内会失败）。
- 首次构建需能访问 `dl.google.com/dl/android/maven2` + `repo1.maven.org`（AGP/依赖）。

## 安装 + 启动（模拟器；Mac 上的 bridge 用 10.0.2.2 访问）

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$ANDROID_HOME/platform-tools:$PATH

adb install -r app/build/outputs/apk/debug/app-debug.apk      # Success
adb shell am start -n dev.dsh.office.tv/.MainActivity         # 走发现/SharedPreferences/默认地址
# 调试覆盖地址（不写 SharedPreferences，重启即失效；App 已在前台时同样生效 -> onNewIntent）：
adb shell am start -n dev.dsh.office.tv/.MainActivity --es url http://10.0.2.2:8765/tv
```

真实启动日志（`adb logcat -s DshTv`，最终验收，2026-11-10 02:25）：

```
DshTv: WebView UA: Mozilla/5.0 (Linux; Android 15; ...) ... Chrome/124.0.6367.219 Mobile Safari/537.36
DshTv: url from intent extra: http://10.0.2.2:8765/tv
DshTv: loadUrl http://10.0.2.2:8765/tv
DshTv: TTS ready (zh-CN, rate=0.95, pitch=1.12)
DshTv: page started http://10.0.2.2:8765/tv
DshTv: page finished http://10.0.2.2:8765/tv (keys enabled)
DshTv: state 连接成功
DshTv: native ready() from page
```

## 最终验收（真实 bridge 页面，2026-11-10）

环境：AVD **`dsh_tv`**（`avdmanager -d tv_1080p -k "system-images;android-35;google_apis;arm64-v8a"`，
无窗口 `-no-window -gpu swiftshader_indirect`），`adb shell wm size` = **Physical size: 1920x1080**。
页面：Mac 上真实 bridge（`http://<mac>:8765/tv`，真实会话数据，非 mock）。

### 1) 页面加载 + 按键（真实 bridge）

```text
$ adb shell am start -W -n dev.dsh.office.tv/.MainActivity --es url http://10.0.2.2:8765/tv
Status: ok   TotalTime: 583

# 短按 OK（戳一下）
$ adb shell input keyevent 23
DshTv: key judge held=0 ms flag=false timer=false
DshTv: key -> ok
DshTv: speak: 咯咯，好痒呀！            ← 网页显示气泡 + 调 DshTvNative.speak 朗读

# 长按 OK 900ms（打开“和鲸鱼娘聊聊”面板）
$ adb shell input keyevent --duration 900 23
DshTv: FLAG_LONG_PRESS on repeat -> long press armed
DshTv: long press armed (600 ms timer)
DshTv: key judge held=0 ms flag=true timer=true
DshTv: key -> long_ok

# BACK（关面板，App 不退出）
$ adb shell input keyevent 4
DshTv: key -> back
topResumedActivity=ActivityRecord{... dev.dsh.office.tv/.MainActivity ...}
```

`adb shell input keyevent --longpress 23` 同样得到 `key -> long_ok`（实测见下方“长按实现”）。

### 2) 一键验收脚本（对真实 bridge 连跑 2 次均满分）

```text
$ TEST_URL=http://10.0.2.2:8765/tv ./verify.sh
== 3. page loaded / TTS ready ==      PASS page finished (keys enabled)
                                      PASS TTS init zh-CN
== 4. short OK -> ok ==               PASS short OK fires ok
== 5. 900 ms hold -> long_ok ==       PASS 900ms hold fires long_ok
== 6. adb --longpress 23 -> long_ok == PASS adb --longpress fires long_ok
== 7. BACK -> back, app stays alive == PASS BACK fires back
                                      PASS app still foreground after BACK
== 8. dpad / menu / alt OK keycodes == PASS dpad directions forwarded
                                      PASS menu forwarded
                                      PASS BUTTON_A(96) -> ok
                                      PASS BUTTON_SELECT(109) -> ok
== 9. result ==                        11 passed, 0 failed
```

### 3) 截图（`assets/`，全部 1920x1080，真实 bridge 数据）

| 文件 | 内容 |
|---|---|
| `screenshot-tv-emulator.png` | 办公室全景（“DSH 深夜办公室”、真实会话/步数、鲸鱼娘亮起） |
| `screenshot-tv-poke.png` | 短按 OK 后戳一戳反应（鲸鱼娘气泡 + TTS 台词） |
| `screenshot-tv-panel.png` | 长按 OK 打开的“和鲸鱼娘聊聊”对话面板（忙/谁/故/听） |
| `screenshot-tv-voice-menu.png` | 面板新增第 5 项「🎤 试一下语音（遥控器麦克风）」高亮 |
| `screenshot-tv-voice-system-ui.png` | 点第 5 项后弹出的系统语音识别 UI（「请说话 / Chinese (China)」） |
| `screenshot-tv-voice-result.png` | 无系统识别服务时（模拟国产盒子）的优雅提示：气泡「这台电视没有系统语音识别…」 |
| `screenshot-tv-back-closed.png` | BACK 关闭面板后回到办公室（Activity 未退出） |
| `screenshot-retry-overlay.png` | 断网时原生浮层“找不到 Mac 上的办公室，正在重试…”（无白屏） |
| `tv-banner.png` | TV 桌面 banner 原图 |

### 4) 断网 → 5 秒重试浮层 → 自动恢复（同一套代码，另测）

```text
DshTv: loadUrl http://10.0.2.2:8799/tv
DshTv: load failed (http-error ...), retry in 5000 ms
DshTv: page finished but load had failed — keeping retry overlay (http://10.0.2.2:8799/tv)
# 服务恢复后：
DshTv: retry #1 -> ...        DshTv: retry #2 -> ...
DshTv: page finished ... (keys enabled)
```

要点：`onReceivedError` / `onReceivedHttpError`（主框架）+ 8 s 加载看门狗进入统一失败状态机；5 s 后重试；
每 3 次失败重新做一次 UDP 发现（Mac IP 变化可自愈）。WebView 自带错误页也会触发 `onPageFinished`，
用 `loadFailed` 标记避免误判成功（否则会隐藏浮层 + 黑屏）。

### 5) UDP 发现（8766）+ SharedPreferences

清数据后不带 `--es url` 启动，用本机假 discovery 响应器（回 `DSH_OFFICE_TV!http://10.0.2.2:8770/index.html`）验证：

```text
DshTv: discovery probe -> 255.255.255.255
DshTv: discovery probe -> 10.0.2.2        # 模拟器 NAT 到 Mac；真机上是各网卡广播地址
DshTv: discovery probe -> 10.0.2.255
DshTv: discovery reply from 10.0.2.2: DSH_OFFICE_TV!http://10.0.2.2:8770/index.html
DshTv: discovered bridge at http://10.0.2.2:8770/index.html
DshTv: loadUrl http://10.0.2.2:8770/index.html
DshTv: page finished http://10.0.2.2:8770/index.html (keys enabled)
```

结果持久化（`adb shell run-as dev.dsh.office.tv cat shared_prefs/tv_url.xml`）：
`<string name="url">…</string>` + `<string name="tv_url">…</string>`；重启走
`DshTv: url from SharedPreferences: …`。URL 解析优先级：`--es url` → `SharedPreferences("tv_url")` → UDP 8766（1500 ms）→ `http://10.0.2.2:8765/tv`。

### 6) WebView 渲染进程被杀 → 自动重建（不崩溃）

```text
$ adb shell pkill -9 -f sandboxed_process0
DshTv: render process gone (crashed=false), rebuilding WebView
DshTv: loadUrl http://10.0.2.2:8765/tv
DshTv: page finished http://10.0.2.2:8765/tv (keys enabled)
```

### 7) APK 清单核对

```text
$ aapt2 dump badging app/build/outputs/apk/debug/app-debug.apk
package: name='dev.dsh.office.tv' versionCode='1' versionName='1.0' ... compileSdkVersion='35'
minSdkVersion:'21'
targetSdkVersion:'34'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.ACCESS_NETWORK_STATE'
application-label:'DSH 办公室'
application: label='DSH 办公室' icon='res/mipmap-mdpi-v4/ic_launcher.png' banner='res/drawable-xhdpi-v4/tv_banner.png'
launchable-activity: name='dev.dsh.office.tv.MainActivity'
leanback-launchable-activity: name='dev.dsh.office.tv.MainActivity'
  uses-feature-not-required: name='android.hardware.touchscreen'
  uses-feature-not-required: name='android.software.leanback'
  uses-feature: name='android.hardware.screen.landscape'
```

## 实现细节（对齐 CONTRACT §5）

**全屏 / 常亮 / 横屏**：`Theme.Black.NoTitleBar.Fullscreen` + `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`（获得焦点重施）、
`FLAG_KEEP_SCREEN_ON`、`screenOrientation=landscape`，`configChanges` 拦 `orientation|screenSize|smallestScreenSize|screenLayout|density|...`。

**按键**（`dispatchKeyEvent`，全部实测）：
- OK 键码：`DPAD_CENTER(23)`、`ENTER(66)`、`NUMPAD_ENTER(160)`、`BUTTON_A(96)`、`BUTTON_SELECT(109)`。
- `ACTION_DOWN repeatCount==0`：记录 `event.getDownTime()`、`startTracking()`、按“距真实按下已过多少 ms”补偿后
  `postDelayed(600ms)` 武装长按；`repeatCount>0` 一律吞掉（不转发）。
- `ACTION_UP`：取消定时器；`wasLong = FLAG_LONG_PRESS || (eventTime - downTime) >= 600ms`；
  长按则发 `long_ok`（不再发 `ok`），否则发 `ok`。
- **为什么用 event 时间戳而不是墙上时钟**：慢盒子/重页面下 UI 线程可能卡 600ms+，`input keyevent 96`
  这种 1ms 的点击会被墙上时钟误判成长按（曾实测到 held=622ms 的假长按）。改用事件时间戳后稳定通过。
- **`FLAG_LONG_PRESS` 兼容路径**：系统在长按后的 repeat 事件上会打该 flag（本机 400ms 就出现），
  `adb input keyevent --longpress` 只注入 400ms 且不带时长，因此该 flag 也视作长按；真机 600ms 定时器仍是主路径。
- `onKeyLongPress` 作为兜底（`longPressFired` 去重，不会与定时器重复触发）。
- BACK 只发 `back`（`dispatchKeyEvent` + `onBackPressed` 双保险），**绝不 `finish()`**；MENU / `MEDIA_PLAY_PAUSE` → `menu`；
  方向键 → `up/down/left/right`；页面 `onPageFinished` 前按键直接丢弃。

**JS 桥**：`addJavascriptInterface(new DshTvNative(), "DshTvNative")`；`@JavascriptInterface` 方法
`ready()/speak(String)/stopSpeak()/log(String)/exit()/startVoiceTest()`。网页侧封装是 `n[fn](arg)` 形式，调用 0 参方法时会多传一个
`undefined`；Chromium 的 Java 桥按参数个数匹配，因此原生侧额外提供了 `ready(String)/stopSpeak(String)/exit(String)/startVoiceTest(String)`
容错重载（否则会静默调用失败）。原生→网页统一
`evaluateJavascript("window.DshTv && window.DshTv.onKey('…')")`（语音结果走 `onVoiceResult(json)`）；`onResume/onPause` 同步给网页；
`onConsoleMessage` 把网页 console 打到 logcat（`DshTv console: …`）。

**TTS**：`TextToSpeech` → `Locale.SIMPLIFIED_CHINESE`、`setSpeechRate(0.95f)`、`setPitch(1.12f)`、
`AudioAttributes.USAGE_ASSISTANT`、`QUEUE_FLUSH`；初始化/语言不可用只打日志（静默降级，不弹窗）；`onDestroy` 里
`stop()+shutdown()`。Manifest 含 targetSdk≥30 必需的
`<queries><intent><action android:name="android.intent.action.TTS_SERVICE"/></intent></queries>`。
本模拟器（google_apis API35）TTS 初始化**成功**：`TTS ready (zh-CN, rate=0.95, pitch=1.12)`，并实际触发朗读
（`speak: 咯咯，好痒呀！`）。
**网页侧现在优先播 `/api/tts`（edge-tts 中文 mp3）**，失败/慢/没有接口才回退原生 `speak()`，见下方「网页语音」。

**WebView**：JS / DOM storage / 媒体自动播放（`setMediaPlaybackRequiresUserGesture(false)`）/ 硬件加速 / cleartext http；
`onTrimMemory` 内存紧张 `clearCache(true)`；`onDestroy` 先 `about:blank` 再 `destroy()`；
启动打印 `WebSettings.getDefaultUserAgent`，Chrome 主版本 <70 记 warning；
`onRenderProcessGone` 重建 WebView 并重载（返回 true，不崩溃）。

**图标 / banner**：`mipmap-*/ic_launcher.png`（48~192 px 五档，鲸鱼娘风格）+ `drawable-xhdpi/tv_banner.png`（640x360）。

## 语音测试按钮（真盒子验证遥控器麦克风）

目的：花 30 秒判断小米盒子5 的遥控器麦克风能不能通过**系统语音识别（RecognizerIntent 借壳）**被我们的 App 用到。
不申请 `RECORD_AUDIO`：录音由系统识别 Activity 自己完成，我们只借它的「请说话」UI 和返回的文字。

### 怎么在真盒子上测

1. 盒子装好 APK、页面能正常显示办公室（`http://<mac>:8765/tv`）后，**长按遥控 OK（≥600ms）** 打开「和鲸鱼娘聊聊」面板。
2. 方向键 ↓ 移到第 5 项 **「🎤 试一下语音（遥控器麦克风）」**，按 OK。
3. 看盒子屏幕和 logcat：

```bash
adb logcat -s DshTv | grep -E 'voice:|tts:'
```

```text
DshTv: voice: startVoiceTest requested
DshTv: voice: recognizer activity = com.xxx/.Yyy        ← 有候选 Activity
DshTv: voice: recognizer activity = NOT FOUND           ← 没有候选（必然 no_service）
DshTv: voice: RecognizerIntent launched (startActivityForResult 7001)
DshTv: voice: result ok text=你好鲸鱼娘                  ← 系统的识别结果
DshTv: voice: result cancelled by user
DshTv: voice: no_service (ActivityNotFoundException: ...)
DshTv: voice: timeout after 20000 ms (recognizer never returned)
DshTv: voice: callback -> {"ok":true,"text":"..."}
DshTv: voice: page got ok text=... / page got fail reason=...
```

4. 结果会在**鲸鱼娘气泡**和**面板回复区**同时显示；页面没 ready / WebView 已销毁时回调是安全 no-op，不会崩。

### 三种/四种结果分别代表什么

| 页面表现 | logcat | 含义 | 结论 |
|---|---|---|---|
| 弹出系统「请说话 / 中文（中国）」界面 | `voice: RecognizerIntent launched` + `voice: recognizer activity = <候选>` | 盒子上存在能处理 `android.speech.action.RECOGNIZE_SPEECH` 的系统 Activity | **有戏**：对着遥控器说话，成功会显示「我听到你说：「xxx」」；若说完没反应，20 秒后自动按超时处理 |
| 气泡「我听到你说：「xxx」」 | `voice: result ok text=...` | 系统识别成功，文字已回传网页 | **有戏**，可继续接 `/api/chat` 做语音对话（当前只做测试展示） |
| 气泡「这台电视没有系统语音识别，遥控器麦克风被小爱占用了，改用手机/USB 麦吧」 | `voice: no_service` | 没有 Activity 处理 `ACTION_RECOGNIZE_SPEECH`（国产盒子最常见：遥控器麦克风被小爱/系统语音独占） | **没戏**：这条借壳路线用不了，改走手机 ASR / USB 麦 |
| 气泡「好啦，不测了」 | `voice: result cancelled by user` | 你在系统 UI 按了 BACK 取消 | 正常，无影响 |
| 气泡「等太久啦」 | `voice: timeout after 20000 ms` | 20 秒内系统识别 UI 没返回（服务卡住/被系统拦截） | 重试一次；仍超时说明识别服务不可用 |

真盒子上最值得看的两个信号：①**有没有弹出系统「请说话」界面**；②`voice: recognizer activity =` 打印的是真实组件还是 `NOT FOUND`。

### 实现

- `DshTvNative.startVoiceTest()`：`Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)` +
  `EXTRA_LANGUAGE_MODEL=LANGUAGE_MODEL_FREE_FORM`、`EXTRA_LANGUAGE="zh-CN"`、`EXTRA_PROMPT="请对着遥控器说话"`、`EXTRA_MAX_RESULTS=1`，
  用 `startActivityForResult(intent, 7001)`；`ActivityNotFoundException` → 回调 `no_service`；20 秒超时 → 回调 `timeout`。
- `onActivityResult`：`RESULT_OK` 取 `EXTRA_RESULTS[0]` → `{ok:true,text}`；`RESULT_CANCELED` → `{ok:false,reason:"cancelled"}`；
  其他 → `error`。超时/no_service 之后迟到的结果会被忽略（`voice: late/duplicate result ignored (...)`），不会重复回调。
- 回调：`evaluateJavascript("window.DshTv && window.DshTv.onVoiceResult(" + json + ")")`，JSON 用 `org.json.JSONObject.quote`
  转义（识别文本里带引号/反斜杠/换行都不会打断 JS 调用）。
- Manifest 的 `<queries>` 额外声明了 `android.speech.RecognitionService` 与 `android.speech.action.RECOGNIZE_SPEECH`
  （targetSdk 34 包可见性），没装识别服务的盒子仍走 `no_service`，不影响构建/启动。

### 模拟器实测（2026-11-10，AVD `dsh_tv`，真实 bridge）

- 弹出系统识别 UI：`voice: recognizer activity = com.google.android.tts/...GoogleTTSActivity`，屏幕出现「请说话 / Chinese (China)」
  （`assets/screenshot-tv-voice-system-ui.png`）。
- `BACK` 取消：`voice: result cancelled by user` → 气泡「好啦，不测了」。
- 停掉识别 Activity 模拟国产盒子：`voice: recognizer activity = NOT FOUND` →
  `voice: no_service (ActivityNotFoundException: ...)` → 气泡「这台电视没有系统语音识别…」（`assets/screenshot-tv-voice-result.png`）。
- 系统 UI 晾 20 秒：`voice: timeout after 20000 ms` → 气泡「等太久啦」；再按 BACK 出现 `voice: late/duplicate result ignored (requestCode=7001, resultCode=0)`。
- 成功分支（模拟器无麦克风无法真说话）：用 CDP 调 `window.DshTv.onVoiceResult({ok:true,text:"你好鲸鱼娘"})` 验证，气泡显示
  「我听到你说：「你好鲸鱼娘」」；同一次 CDP 采集的 console **0 error**。
- 面板截图：`assets/screenshot-tv-voice-menu.png`（第 5 项高亮）。

### 网页语音（/api/tts 优先，系统 TTS 兜底）

`bridge` 的 `GET /api/tts?text=<urlencoded>`（edge-tts 中文神经语音 mp3）可用时，页面用 `new Audio(...)` 播放，并在 logcat 打
`tts: playing /api/tts audio (N chars)`。以下情况自动回退 `DshTvNative.speak(text)`（Android 系统 TTS）：
接口 503/404/网络失败、`audio` 报 error、`play()` 被拒、或 3500ms 还没真正播起来（edge-tts 慢/空音频）——
日志 `tts: /api/tts failed (<reason>) -> native speak`。字幕/打字机逻辑完全不变，现有台词字符串未改动。

- 首次用户按键后才启用音频（解锁 WebView 自动播放策略，日志 `tts: audio unlocked by first user key`）；
  同一句 200ms 内不重复播（去抖）。
- 实测（真实 bridge）：`tts: playing /api/tts audio (8 chars)`；
  用 `TTS_ENABLED=0` 起第二个 bridge（`/api/tts` 返回 503）时：`tts: /api/tts failed (media error) -> native speak` +
  `DshTv: speak: 尾巴是我的小方向盘～`，两条路径都验证过。

## 网页侧联调发现（供 web-scene-builder 参考，不影响客户端验收）

1. 浏览器 console 有一条 `Uncaught ReferenceError: drawPetFrame is not defined (app.js:2271)`：
   实际宠物绘制函数名是 `petDrawFrame`（`app.js:1520`），`loadPetIndex()` 成功回调里误调了 `drawPetFrame(true)`。
   页面仍能画出鲸鱼娘（有其它兜底路径），但建议改掉，避免动画首帧/切换 clip 时丢帧。
2. 网页通过 `native('ready')` 调用时实际执行的是 `n.ready(undefined)`（多一个参数）——客户端已加容错重载，
   `DshTv: native ready() from page` 已能打印。若网页想更严谨，可把封装改成无参时不传参数：
   `if (typeof arg === 'undefined') n[fn](); else n[fn](arg);`。

## 已知限制 / 真机注意事项

1. 长按在**真实遥控器**上建议再点测一次：不同盒子可能只发 down/up（走 600 ms 定时器 + 事件时间戳）或带
   repeat flag（走兼容路径），两条路都实现且有日志（`long press armed (600 ms timer)` / `FLAG_LONG_PRESS on repeat`）。
2. TTS 依赖盒子上有中文语音引擎；没有时静默不朗读、不报错（日志 `TTS init failed` / `Chinese TTS data unavailable`）。
3. UDP 广播要求电视和 Mac 同二层网络且 AP 未开启客户端隔离；发现失败会用 SharedPreferences/默认地址，
   每 3 次失败自动再发现一次。
4. 未做设置界面（URL 通过发现/SharedPreferences/`--es url` 配置，契约未要求）。
5. `testpage/index.html` 仅用于网页未上线/改造时验证按键链路，最终验收用的是真实 `/tv` 页面。
6. 语音测试按钮在模拟器上只能验证「弹系统识别 UI / 取消 / 20s 超时 / no_service」；模拟器没有遥控器麦克风，
   真正的「说话→返回文字」必须在小米盒子5 上点一次。若真盒子直接 `no_service`（系统识别入口不暴露给第三方），
   遥控器麦克风对普通 App 基本无解，得改走手机端 ASR 或 USB 麦。
7. TTS 现在优先 `/api/tts`（edge-tts）；Mac 上没装 edge-tts 时接口返回 503，页面自动回退盒子自带系统 TTS，
   不报错、不黑屏（日志 `tts: /api/tts failed (...) -> native speak`）。

## 一键验收

```bash
# 真实 bridge（默认 http://10.0.2.2:8765/tv）
cd tv-app && ./verify.sh
# 网页异常时用自测页（先在宿主机起 8770）
(cd testpage && python3 -m http.server 8770 --bind 0.0.0.0 &)
TEST_URL=http://10.0.2.2:8770/index.html ./verify.sh
```
