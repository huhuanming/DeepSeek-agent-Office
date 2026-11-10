# DSH Office TV — 接口契约（v1，冻结）

本文件是 `tv-app/`（Android TV APK）与 `bridge/`（Mac 端服务 + 电视网页）之间**唯一**的约定。
两边都只依赖本文件，不要再各自发明接口。改动契约必须同时通知 Lead。

## 0. 一句话架构

Mac 上跑 `bridge`（Node，零依赖）：读 `~/.dsh/storages/session_projcache` 得到真实会话状态 → 渲染/供给一个全屏像素办公室页面 + 鲸鱼娘素材。
Android TV APK 是**瘦客户端**：全屏 WebView 打开 `http://<mac-ip>:8765/tv`，负责遥控按键、长按检测、TTS、保持常亮、连不上时自动重试。

## 1. 目录与职责边界（严格不要越界写别人的目录）

```
deepseek-office-tv/
├── CONTRACT.md          # 本文件（Lead 维护）
├── PLAN.md              # 方案文档（Lead 维护）
├── research/            # 调研报告（研究 teammate）
├── bridge/              # ★ bridge-builder 独占
│   ├── server.mjs       # HTTP + UDP 发现 + 静态资源
│   ├── state.mjs        # 读 projcache → OfficeModel
│   ├── chat.mjs         # 鲸鱼娘对话（无 key 时用本地解说）
│   ├── assets.mjs       # 鲸鱼娘帧服务
│   ├── config.json      # 端口 / 素材路径 / API key（可选）
│   └── web/             # 电视网页（index.html / app.js / style.css）
├── tv-app/              # ★ tv-app-builder 独占（Gradle 工程）
├── tools/               # bridge-builder 独占（serve.sh / install.sh）
└── assets/              # Lead 生成（banner/icon/截图）
```

## 2. 端口与地址

- Bridge HTTP：`0.0.0.0:8765`（可用 `PORT` 环境变量覆盖，网页里不要写死端口，用相对路径）。
- 电视页：`GET /tv`
- UDP 发现：`8766`。APK 发 `DSH_OFFICE_TV?`（ASCII，无换行）到 `255.255.255.255:8766`，bridge 回 `DSH_OFFICE_TV!http://<手机能访问到的内网IP>:8765/tv`。APK 等 1500ms，收到即用；收不到就用内置默认地址并每 5 秒重试。

## 3. HTTP 接口

### GET /health
`{"ok":true,"name":"dsh-office-tv","version":"0.1.0"}`

### GET /api/state
2 秒轮询一次，`Cache-Control: no-store`。

```json
{
  "ts": 1794247000000,
  "pet": { "mood": "working", "since": 1794246000000 },
  "stats": { "sessions": 6, "running": 2, "teammates": 4 },
  "workspaces": [
    {
      "id": "default-workspace",
      "name": "default-workspace",
      "cwd": "/Users/x/Documents/deepseek-harness/default-workspace",
      "sessions": [
        {
          "id": "session-ce6d8fbd",
          "title": "参考 agent-office 做 DeepSeek Office",
          "running": true,
          "status": "working",
          "elapsedSec": 312,
          "step": 17,
          "turns": 1,
          "activity": "正在调用工具 · 第 17 步",
          "lastActivityAt": 1794247000000,
          "todos": { "done": 3, "total": 7 },
          "team": [ { "name": "ecosystem-scout", "role": "teammate", "state": "running" } ]
        }
      ]
    }
  ]
}
```

- `status` 枚举：`working | waiting | success | idle | error`（bridge 负责推导，网页只上色/换动画）。
- `pet.mood` 枚举与鲸鱼娘动画同名：`idle | idle_yawn | idle_stretch | thinking | working | working_command | working_search | waiting | success | error | poke | head_pat | tail | eat_token | dragging | dragging_release`。
- 最多返回 24 个会话，按 `lastActivityAt` 倒序；网页自己分页/滚动。

### POST /api/chat
请求 `{"question":"他们现在在忙什么？","sessionId":"可选"}` → 200 `{"reply":"……","speak":"……","source":"llm|narration"}`
- 未配置 API key 时**必须**仍能工作：`source:"narration"`，用 `/api/state` 的实时状态拼出鲸鱼娘口吻的回答（这是原型的主要模式）。
- 配置了 `DEEPSEEK_API_KEY` 时走真实模型：system prompt 里注入当前办公室状态摘要，人设见 PLAN.md。失败要降级成 narration，不能 500。

### GET /api/tts?text=<urlencoded>&voice=<可选>
返回 `audio/mpeg`（中文神经语音，默认 `zh-CN-XiaoyiNeural`，磁盘缓存）。网页优先播这个；失败（503/网络/自动播放被拒）再调 `DshTvNative.speak(text)`，字幕始终显示。
- 限制：`text` ≤ 200 字、必填；`voice` 可选，用于预览其它音色。
- 不可用时返回 503 文本 `tts_unavailable`，网页必须降级而不是报错。

### GET /api/pet
```json
{ "baseSize": 412, "maxFrameWidth": 412, "maxFrameHeight": 344, "fps": 24,
  "clips": { "idle": ["/pet/idle/idle_001.webp", "..."], "poke": ["..."] } }
```
- 只暴露网页需要的 6~8 个 clip（idle, idle_yawn, thinking, working, success, error, poke, head_pat, tail 等），避免一次拉 16 个 clip 的索引。
- `GET /pet/<clip>/<frame>` 直接流式返回 webp（`Cache-Control: public, max-age=86400`），从 `~/.dsh/profiles/desktop/node_modules/dsh-dafeiyu/assets/pet/` 读；路径要防目录穿越。

### 静态
`GET /` → 302 到 `/tv`；`/tv`、`/app.js`、`/style.css` 由 `bridge/web/` 提供。

## 4. 原生 ↔ 网页 桥

### 4.1 网页 → 原生（`addJavascriptInterface` 对象名 `DshTvNative`）
```ts
interface DshTvNative {
  ready(): void;              // 页面可交互后调用一次，原生收到后开始转发按键
  speak(text: string): void;  // 交给 Android TTS；网页也要同时显示字幕
  stopSpeak(): void;
  log(msg: string): void;     // 原生 logcat 打 "DshTv: ..."
  exit(): void;               // 退出 App
  startVoiceTest(): void;     // 弹出系统语音识别（RecognizerIntent），用来验证遥控器麦克风；结果走 window.DshTv.onVoiceResult
}
```
网页必须容错：`window.DshTvNative` 不存在时（浏览器调试）全部降级为 no-op。

### 4.2 原生 → 网页（`evaluateJavascript` 调 `window.DshTv.onKey(action)`）
```js
window.DshTv = {
  onKey: function (action) {},   // action: 'ok' | 'long_ok' | 'back' | 'up' | 'down' | 'left' | 'right' | 'menu'
  onResume: function () {},      // App 回到前台
  onPause: function () {},
  onVoiceResult: function (payload) {}  // {ok:true,text} | {ok:false,reason:'no_service'|'cancelled'|'timeout'|'error'}
};
```
- `ok` = 短按遥控 OK：戳一下鲸鱼娘（随机 `poke`/`head_pat`/`tail` 动画 + 一句台词）。
- `long_ok` = 长按 OK（≥600ms）且松开时不触发短按：打开"和鲸鱼娘聊聊"面板。
- `back`：先关面板，再回到办公室（**禁止**直接退出 App 导致小孩看到桌面）。
- `up/down/left/right`：网页自己维护焦点环，不做 Android 原生焦点导航。

浏览器调试约定：Enter→`ok`，按住 Enter≥600ms→`long_ok`，Escape→`back`，方向键→方向。

## 5. APK 侧硬性要求

- `minSdk 21`、`targetSdk 34`、`compileSdk 35`、`applicationId dev.dsh.office.tv`。
- `LEANBACK_LAUNCHER` + 普通 `LAUNCHER` 都声明（国产盒子不一定有 leanback 桌面）；`android.software.leanback` required=false，`android.hardware.touchscreen` required=false。
- 横屏、全屏 immersive sticky、`FLAG_KEEP_SCREEN_ON`。
- `usesCleartextTraffic=true`（局域网 http）。
- 默认地址：先 UDP 发现，再 `SharedPreferences("tv_url")`，再内置 `http://10.0.2.2:8765/tv`（模拟器默认）；另外支持 `adb shell am start -n dev.dsh.office.tv/.MainActivity --es url http://ip:8765/tv` 覆盖，方便调试。
- 加载失败/超时：显示"找不到 Mac 上的办公室，正在重试…" + 每 5 秒自动重试，不允许白屏或崩溃。
- 长按实现：`dispatchKeyEvent` + `event.startTracking()` + `onKeyLongPress`（同时用 `postDelayed` 600ms 兜底），`repeatCount>0` 的重复事件必须忽略；松开时如果长按已触发则**不再**发 `ok`。
- OK 键必须同时认：`DPAD_CENTER(23)`、`ENTER(66)`、`NUMPAD_ENTER(160)`、`BUTTON_A(96)`、`BUTTON_SELECT(109)`——不同遥控器/手柄上报的键码不一样。
- TTS 参数：`Locale.SIMPLIFIED_CHINESE`，`setSpeechRate(0.95f)`、`setPitch(1.12f)`（给小孩、鲸鱼娘音色），`AudioAttributes` 用 `USAGE_ASSISTANT`；`targetSdk>=30` 时 manifest 里 `<queries>` 要声明 `android.intent.action.TTS_SERVICE`，否则 `TextToSpeech` 找不到引擎。
- TTS：`TextToSpeech(Locale.CHINA)`；初始化失败只打日志、不弹错；`speak` 用 `QUEUE_FLUSH`；退出时 `shutdown()`。
- 不要申请 INTERNET 之外的敏感权限（INTERNET + ACCESS_NETWORK_STATE 即可）。
- WebView 设置：JS、DOM storage、媒体自动播放、hardware acceleration；不要 `setJavaScriptEnabled(false)` 兜底。
- WebView 长跑硬化（小孩会开几小时）：`onDestroy`/`onPause` 时 `loadUrl("about:blank")` + `destroy()`；`onTrimMemory` 时释放缓存；`onRenderProcessGone` 重建 WebView；`configChanges` 拦住分辨率切换重建；启动时把 `WebSettings.getDefaultUserAgent` 版本打日志（<Chrome/70 提示降级）。
- 防烧屏：页面静止 60-120 秒整体像素位移 ±2px（由网页做，APK 不管）。

## 6. 验收（两边都要自测）

1. `node bridge/server.mjs` → `curl localhost:8765/health`、`/api/state` 返回当前真实会话（标题对得上）。
2. 浏览器打开 `http://localhost:8765/tv` 全屏 1920×1080 和 1280×720 都正常；Enter 长按能开面板。
3. `cd tv-app && ./gradlew assembleDebug` 产出 `tv-app/app/build/outputs/apk/debug/app-debug.apk`；`adb install -r` 到模拟器成功。
4. 模拟器里：`adb shell input keyevent --longpress 23` 能打开对话面板；`input keyevent 23` 是戳一下；`input keyevent 4` 能关闭面板且不退出。
5. 断网（停掉 bridge）后 5 秒内出现重试提示，恢复后自动回到办公室。
