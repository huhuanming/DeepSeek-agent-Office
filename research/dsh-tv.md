# dsh-tv 深挖报告（只读）

> 仓库：https://github.com/thuyqpham/dsh-tv · clone 于 `/tmp/dsh-tv`（35MB，**只有 1 个 commit**，`226d7d6 apk: blur-scrim overlay`）
> 结论时间：2026-11-10 · 读完 24 个 Java、3 个 Python/Node 宿主脚本、全部 res 与 DESIGN.md

## 一、结论：不 fork，借零件，鲸鱼娘素材不用

**a) fork 还是借零件？→ 只借零件。** 理由：仓库只有 1 个 commit、0★、**零测试**、无 Gradle（手写 aapt2/javac/d8/apksigner）、无 androidx、**整个 app 的 classes.dex 只有 89,808 B**（80 个类，含内部类）；它的产品形态是「语音遥控器 + 浮层宠物」，没有办公室、没有多会话、没有聊天面板，**fork 后要改的地方比从我们的 WebView 骨架重写还多**。但它踩通的 4 件事值得直接抄代码（见第三节）：QR 配对、TV 侧 HTTP 控制 API、TTS 包装、无 Gradle 构建脚本。

**b) 有没有办公室/多会话可视化可复用？→ 没有，一行都没有。** `grep -rn office/session` 只命中 `host/whale_voice.py` 里一个 **DSH 持久会话 id**（`--session-id`）用于多轮上下文，以及 `ApiHandler.state()` 返回**前台 App 名**（`ApiHandler.java:120-149`）。UI 只有三个屏：Bridge 状态页、配对页、鲸鱼娘浮层（`DESIGN.md:94-132`）。它对"多 agent/多会话"的认知为零——**我们的办公室模型必须自己写**，但它那套"宿主机 ↔ TV HTTP 双向通道"正好是我们喂数据的现成管子。

**c) license 真的是 MIT 吗？→ 代码是，素材/图标不是全 MIT。** `LICENSE` 是标准 MIT（`Copyright (c) 2026 Whale-chan contributors`，无附加条款）。但：
- `THIRD-PARTY.md`：当前 6 段动画来自 **1tryout/dsh-whale-pixel-pet（MIT）**，早期设计用 **Er1c0v0/dsh-whale-pet（人物 CC BY 4.0）**；
- `android/tv-assistant/res/raw/attribution.txt` 却只写 "© Er1c0v0, CC BY 4.0"——**与实际资产不符（声明过期）**；
- `res/values/strings.xml` 的 `credit` 两个都写；
- App 图标/Banner 用 **DeepSeek 鲸鱼 emblem**，`THIRD-PARTY.md` 明说"不在 MIT 内、正式分发前应替换或取得许可"。
→ 代码可放心 MIT 复用（保留声明）；**图标/banner/宠物 WebP 不要直接搬**。

---

## 二、关键事实（逐项回答）

### 2.1 TV 壳技术栈
- **纯 Java + Android framework，零第三方依赖、零 androidx、零 native lib、无 Gradle**（`.github/workflows/build-apk.yml` 用 setup-android + JDK17，然后 `bash android/tv-assistant/build.sh`）。
- 三个 Activity + 三个 Service：
  - `MainActivity`（bridge 状态/开关）、`PairingActivity`（二维码配对）、`WhaleActivity`（透明浮层宠物 + 语音）；
  - `BridgeService`（前台服务，在 TV 上跑 **HTTP server 8765**）、`KeyService`（无障碍，代按遥控键/输入文字/截图）、`WhaleVoiceService`+`WhaleSessionService`（可选把自己注册成默认 Assistant）、`WhaleRecognitionService`（**空壳**，只为 AssistantRole 校验，`WhaleRecognitionService.java:10-30`）。
- `AndroidManifest.xml:7`：**minSdk 26（Android 8.0）/ targetSdk 33**；README 说 "Android TV / Google TV, Android 9+（实测 onn. 4K Pro / Android 14）"。
- Leanback：`AndroidManifest.xml:18-20` 三个 feature 全 `required="false"`；`:49-53` 主 Activity **同时**挂 `LAUNCHER` + `LEANBACK_LAUNCHER`（国产盒子桌面也能看到）；`:33-36` 有 `android:banner`；`:39` `usesCleartextTraffic="true"`（裸 HTTP 局域网）。
- 安装/启动：`adb install -r -g TVAssistant.apk` → `pm grant RECORD_AUDIO` → 手动开无障碍（`adb shell settings put secure enabled_accessibility_services ...`，README: 60-70 行）→ 配对后从桌面图标或遥控器自定义键进入 WhaleActivity。

### 2.2 遥控长按怎么处理的？——**根本没处理**
- 全仓 `grep startTracking|onKeyLongPress|isLongPress|repeatCount` **零命中**。
- `WhaleActivity.java:84-97` 只重写 `onKeyDown`：`DPAD_CENTER/ENTER/NUMPAD_ENTER` → `ui.commit()`（提前结束收音），`BACK` → `finish()`。**没有 `event.startTracking()`，没有长按分支**。
- `MainActivity` 完全靠 View 焦点（`setOnFocusChangeListener` 做 1.03 缩放 + elevation，`MainActivity.java:149-159`）——没有自绘焦点环、没有 D-pad 方向键逻辑（交给系统）。
- 结论：**"长按 OK 开聊天"要从零加**，且它现在的 `onKeyDown` 会**先吃掉 OK 键**（`return true`），所以正确姿势是：`onKeyDown` 里 `event.startTracking()` 后**不要**立即 return true，等 `onKeyUp` 按 `event.getEventTime()-event.getDownTime() >= 600ms` 或 `onKeyLongPress` 判定，短按才 `commit()`。WebView 方案下更简单：`dispatchKeyEvent` 只把 `KEYCODE_DPAD_CENTER` 的 down/up/long 转发给网页（见 CONTRACT 的 `window.DshTv.onKey`）。
- 顺带：它把"OK=提前发送"写进 DESIGN（`DESIGN.md:125`），**与我们"短按=戳、长按=聊天"冲突，不能沿用意**。

### 2.3 TTS / ASR 链路：ASR 在宿主机，TV 只录音
- **ASR（SenseVoice）跑在 Mac/Linux 宿主**，TV 只采 16k 单声道 WAV 上传：
  - `MicCapture.java:28-34`：16kHz、20ms/帧、12s 上限、7s 无语音放弃、尾静音 45 帧（~900ms）端点检测；`:210-238` 开 AEC/AGC/NS。
  - `WhaleClient.java:31-46` `POST http://host:8766/stt`（`audio/wav`），`:49-67` `POST /ask`（JSON）。
  - 宿主 `host/whale_voice.py:200-271`：优先 **DSH 同款 SenseVoiceSmall**（`host/dsh_stt.mjs:26-51`，`sherpa-onnx` + `model.int8.onnx` + `tokens.txt`，CPU、2 线程，模型在 `~/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx`）；失败回落 **mlx-whisper**（`mlx-community/whisper-base.en-mlx`，Apple Silicon 专用）。
  - **模型大小/算力问题不存在**：模型**永远不跑在盒子上**，低端盒子只解码 WAV 上传、播放音频。宿主侧 DSH 官方描述为"Host CPU 上 SenseVoiceSmall ONNX + Silero VAD，按需拉起 sherpa-onnx 进程"。
- **TTS 在 TV 本地**：`WhaleUi.java:51-66` 用 Android `TextToSpeech`，**`setLanguage(Locale.US)`（写死英文）**；`Tts.java`（/speak 接口）同样 `Locale.US`。**中文场景必须改 `Locale.CHINA`**，且国产盒子若无 TTS 引擎会静默失败（`WhaleUi.speak()` 全 try/catch 吞掉）。
- 无唤醒词、无常听：靠遥控器麦克风键（默认助理角色）或 Disney+ shim；一次 `listen()` 一条语音，`ask` 同步等 DSH 回合（读超时 180s）。

### 2.4 鲸鱼娘动画：哪来的、什么格式、授权怎么写
- 文件：`android/tv-assistant/res/raw/whale_{idle,wave,think,busy,wilt,celebrate}.webp`，**6 段透明动画 WebP，1.23–1.91MB/段，共 9.4MB**（占 9.2MB APK 的 97%）。
- 来源/管线：`android/tv-assistant/make-pet-assets.sh` 从 **1tryout/dsh-whale-pixel-pet** 的 `dsh-pet/assets/webm/*.webm`（VP9-alpha）裁 `crop=360:360:140:0` → `scale=440:440` → `fps=12` → Pillow 合成 animated WebP（quality 58）；六段对应"待机呼吸休闲 / 点击回应-元气挥手 / 工作状态-思考冒泡 / 忙碌点按 / 垂头叹气冒汗 / 雀跃庆祝"。
- 播放：`WhalePet.java:33-61` 用 `ImageDecoder.decodeDrawable` → `AnimatedImageDrawable`（**API 28+**）；`:79-83` 低于 28 回退 `BitmapFactory` **只显示首帧**（minSdk 26、27 的盒子动画会"僵住"）。
- 授权：见第一节 c)；`attribution.txt` 与 `THIRD-PARTY.md` 不一致，**我们若要复用得自己整理声明**。

### 2.5 与宿主机的通信协议（可复用的两端）
- **双向两条 HTTP，都没有 WebSocket**：
  1. **TV → 宿主（8766）**：`POST /stt`（WAV→text）、`POST /ask`（{text}→{reply, sessionId}）、`GET /health`、配对三连 `GET /pair/new`、`GET /pair/status?id=`、`POST /pair/approve`。Token：`X-Whale-Token` 头或 `?token=`（`whale_voice.py:356-361`）。宿主侧 `DshVoice.ask()` 直接 `subprocess` 调 `dsh --profile headless --json [--session-id <id>] "<BRIEF+transcript>"`，解析 JSONL 的 `session`/`final`/`status(turn_end)` 事件（`whale_voice.py:274-329`）。
  2. **宿主 → TV（8765）**：TV 内 `BridgeService` 起 `ServerSocket`（`BridgeService.java:104-133`，8 线程池、10s 超时、token 校验 `:231-255`、mDNS `_dshtv._tcp` 广播 `NsdHelper.java`），路由在 `ApiHandler.java:33-74`：`/ping /info /state /key?code=ok&n=2 /text?q= /launch?app=|pkg=|url= /apps /screenshot /voice /speak?text= /mic?seconds= /volume`。宿主侧客户端 `host/dshtv.py`（1043 行）封装成 `DshtvClient.key/text/launch/apps/screenshot/mic/volume`，并被 agent 用 bash 调用来"操控电视"。
- 配对流程：TV 显示宿主返回的二维码（base64 PNG）→ 手机扫码打开宿主 `/pair` 页面 → 点"Approve" → TV 轮询 `/pair/status` 拿到 `{host,port,token}` 存 `SharedPreferences`（`PairingActivity.java:97-211`、`WhaleConfig.java`）。**这套流程与我们的"bridge 提供服务 + TV 自动发现"高度同构，可直接照搬协议形状。**

---

## 三、可偷的代码清单（路径 + 为什么 + 改动点）

| 文件 | 偷什么 | 改造点 |
|---|---|---|
| `android/tv-assistant/src/com/jp/dshtv/PairingActivity.java`（240 行） | QR 配对全流程：`/pair/new` → 显示 QR+6 位码 → 轮询 `/pair/status` → 存 host/port/token → 跳转 | 改成我们的 `/api/pair/*`、存进 `DshTvConfig`；去掉 `WhaleActivity` 硬跳 |
| `android/tv-assistant/src/com/jp/dshtv/WhaleConfig.java`（43 行） | SharedPreferences 三件套（host/port/token + paired 标志）+ BUILD 期默认值兜底 | 直接复用，换成我们的 prefs 名 |
| `android/tv-assistant/src/com/jp/dshtv/BridgeService.java`（315 行） | TV 侧 HTTP server 骨架：ServerSocket、8 线程池、token 中间件、`Access-Control-Allow-Origin: *`、`Cache-Control: no-store`、前台通知保活 | 我们的 bridge 在**宿主机**跑 Node，这层可不用；但"token 校验 + 405/401/404 语义 + no-store"值得照抄到 Node |
| `android/tv-assistant/src/com/jp/dshtv/ApiHandler.java` + `Http.java` + `Json.java`（529+211+137 行） | 极简 HTTP 解析/响应 + 手写 JSON（零依赖）；`/key /text /launch /apps /screenshot /speak /volume` 的完整参数与错误码约定 | 若走"宿主机驱动 TV"，这套 API 契约可原样变成我们 CONTRACT 第 2 节的扩展 |
| `android/tv-assistant/src/com/jp/dshtv/KeyMap.java`（129 行） | 遥控键名 → `AccessibilityService.GLOBAL_ACTION_*` / `KeyEvent` / `AudioManager` 的映射表（up/down/left/right/ok/back/home/recents/playpause/volup/voldown/mute…），三档错误码 | 直接抄表；注意无障碍权限在某些国产盒子受限 |
| `android/tv-assistant/src/com/jp/dshtv/AppIndex.java`（244 行） | 枚举所有 `LAUNCHER`/`LEANBACK_LAUNCHER` 应用，按**包名→标签模糊匹配**启动，支持 URL | 我们若做"电视桌面入口/启动 App"可复用；纯查询、无副作用 |
| `android/tv-assistant/src/com/jp/dshtv/Tts.java`（98 行） | 懒加载 TextToSpeech + 8s 初始化超时 + 单例 + `speak()` 结果码 | **必须把 `Locale.US` 改 `Locale.CHINA`**，并加"无引擎时返回 false 让 UI 显示字幕" |
| `android/tv-assistant/src/com/jp/dshtv/MicCapture.java`（288 行） | 16k/20ms 帧 + 能量 VAD（地板自适应阈值 `max(150, floor*2)`）+ 端点 + AEC/AGC/NS + WAV 头拼装 | 语音阶段再要；比 Web Speech API 在 TV 上可控 |
| `android/tv-assistant/src/com/jp/dshtv/WhalePet.java`（85 行） | `ImageDecoder` 播动画 WebP + API<28 回退首帧 + 资源缓存 | 若我们走原生宠物层可抄；WebView 方案用不上 |
| `android/tv-assistant/build.sh`（57 行） | **无 Gradle** 的 APK 构建：aapt2 compile/link → javac --release 8 → d8 --min-api 26 → zipalign → apksigner；BUILD 期注入 `res/values/config.xml`（host/port/token） | 我们的 tv-app 有 Gradle 就不用；但"构建期注入默认 host/token"这个技巧值得保留（debug 快速侧载） |
| `DESIGN.md:84-93`（10-foot 规则）+ `docs/ui-mockup.html`（3.5MB 自包含） | 焦点环 2dp + 1.03 缩放 + 120ms、控件 56dp、正文 ≥16sp、状态"点+字"双编码；mockup 可直接浏览器打开对照 | 交给 web-scene-builder 当视觉验收基准 |
| `host/whale_voice.py:344-491`（530 行） | 宿主机极简 HTTP 服务 + token + 配对页 + `/stt` `/ask` 实现 | 我们的 bridge 是 Node，参考其"错误码/超时/静音 RMS<90 直接返回空"的健壮性细节 |

**明确不要偷**：`res/raw/whale_*.webp`（9.4MB 且授权声明混乱）、`res/drawable/ic_launcher.png`/`banner.png`（DeepSeek emblem，不在 MIT）、`android/disney-shim/`（硬编码 `com.disney.disneyplus` 抢占遥控器按键，只对 onn 遥控器成立，国产盒子无效且很脏）。

---

## 四、它的坑（按危害排序）

1. **长按没有、OK 键还被提前消费**：`WhaleActivity.onKeyDown` 直接 `return true`；要做长按必须重写按键分发（见 2.2），别照抄。
2. **宠物动画 9.4MB / APK 9.2MB，且 97% 是动画**；6 段 ×1.2–1.9MB。我们若用 WebView 帧序列，必须自己压（PNG/WebP 序列 + 尺寸 440 以下）。
3. **API 26/27 动画降级为静态首帧**（`WhalePet.java:79-83`），minSdk 26 与动画能力不匹配；要改 minSdk 28 或换帧动画。
4. **TTS 写死英文**（`WhaleUi.java:57`、`Tts.java:47`），中文盒子还可能根本没有 TTS 引擎 → 静默无声。
5. **强依赖宿主机**：没配对没宿主，打开只有状态页/配对页；`WhaleActivity` 未配对直接跳走（`WhaleActivity.java:25-29`）。**不是自治 App**。
6. **配对要靠"输 IP"兜底**：二维码只指向宿主 `/pair` 页面；TV 端首次仍需 IP（`PairingActivity` 有 EditText）。国产盒子若无输入法（IME），TV 上根本敲不了 IP → 首次配对会卡死。
7. **无障碍是硬门槛**：按键注入、文字输入、截图全依赖 `KeyService`；国产盒子（华为/小米等）常限制或隐藏无障碍设置，未开启时 `/key /text /launch` 全部 503。
8. **`/screenshot` 需 Android 11（API 30）+ canTakeScreenshot**（`ApiHandler.java:277-305`），低版本盒子直接不可用。
9. **遥控器 hack 不可移植**：Disney+ shim 抢 `com.disney.disneyplus` 包名；国产盒子厂商自定义键不开放。
10. **安全姿势偏松**：`Access-Control-Allow-Origin: *` + token 可走 `?token=` query（会进日志）；debug 签名、`usesCleartextTraffic=true`、`QUERY_ALL_PACKAGES`。自用可接受，别照搬到要分发的版本。
11. **工程风险**：1 commit、0★、无测试、无 CI 测试、未用 Gradle、无依赖锁；作者为匿名"Whale-chan contributors"。可以当"参考实现"，不能当"上游依赖"。
12. **素材声明过期/不一致**（`attribution.txt` vs `THIRD-PARTY.md` vs `strings.xml`）——如果我们要用它的宠物资产，得先把来源重新核实。

---

## 五、`TVAssistant.apk` 直接 sideload 到国产盒子？——能装，但"先看个效果"不够

实测下载分析（`v0.1.0`，9,669,438 B）：
- **架构无关**：`unzip -l` 里 **`lib/` 数量为 0**，纯 Java/DEX（`classes.dex` 仅 89,808 B，80 个 `com/jp/dshtv` 类引用）→ arm64 / armeabi-v7a / x86 都能跑，**不存在架构选错问题**。
- **签名**：`META-INF/ANDROIDD.RSA`，`openssl` 解开是 `CN=Android Debug` → **debug 签名**，可侧载（首次安装无冲突），但换签名版本不能覆盖安装。
- **不依赖 Google 服务**：dex 里 `com.google.android.gms` / `firebase` 命中数 **均为 0**；mDNS 用系统 `NsdManager`，不依赖 Play Services。
- **系统要求**：Android 8.0+（动画要 9.0+/API 28 才动），有麦克风；`LAUNCHER` + `LEANBACK_LAUNCHER` 双入口，国产桌面能找到图标。
- **但**：装完打开只会看到 **Bridge 状态页**；点"Get started"进配对页，需要**先有一台跑起 `host/whale_voice.py` 的 Mac/Linux**（要 DSH CLI + DEEPSEEK_API_KEY + Node + sherpa-onnx + ffmpeg，可选 mlx-whisper），且 TV 与宿主同网段。**没有宿主 = 看不到鲸鱼娘**，只有配对界面。所以"只想先给孩子看个效果"它不满足；要"看效果"，反而是在电视上装 `DSH Go`（手机 APK，内置鲸娘，但触屏 UI + 需 1GB 运行时）或直接用我们的 web 页在电视浏览器里打开更省事。

**给 lead 的落地建议（与我们 WebView 方案对齐）**：
1. 采用它的**配对协议形状**（`/api/pair/new` → 二维码 → 轮询 status → 下发 host/port/token）+ **TV 端 SHARED_PREFS 默认地址**（`adb shell am start ... --es url http://x:8765/tv` 也能覆盖，类似 `MainActivity.handleIntent` 的 extras 技巧）。
2. 按键：沿用我们 CONTRACT 的 `dispatchKeyEvent` 转发方案，但**按 2.2 的坑**处理 OK 键：`startTracking()` + `onKeyLongPress`/`ACTION_UP` 计时 600ms，短按 poke、长按开面板，**长按后 keyUp 必须吞掉**。
3. 借 `KeyMap/AppIndex/ApiHandler` 的**能力清单**（不是代码），把 `/state /key /launch /apps /screenshot` 作为 bridge 的可选扩展（孩子长大想"用嘴指挥电视"时直接加）。
4. TTS 若用 Android 原生：抄 `Tts.java` 的懒加载结构，改 `Locale.CHINA`，并做"引擎缺失 → 只用字幕"降级。
5. 视觉验收基准直接用它的 `DESIGN.md` 10-foot 规则 + `docs/ui-mockup.html`；**图标/鲸鱼娘一律用我们自己的**（MIT 素材或自绘），不碰 DeepSeek emblem。
