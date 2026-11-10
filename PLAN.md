# DSH Office TV · 把 DeepSeek 的办公室搬上电视

> **项目位置：`/Volumes/T7Shield/Project/deepseek-office-tv`**
> 一句话：**Mac 上的 DSH 当大脑，电视盒子上的 APK 当屏幕**。像素鲸鱼娘在办公室里值班，小朋友看 AI 小人们上班；长按遥控 OK 就能和鲸鱼娘互动。

---

## 一、先回答你的问题：有没有现成的 DeepSeek Office？

我把生态翻了一遍，分三层回答：

### 1）手机端有现成的整机，但不是电视版
- **[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)**（你说的 "dsh go"）：DSH 的 Android 客户端，Flutter，**AGPL-3.0**，Android 8+，能连你电脑上的 DSH，内置 Deepy 小鲸鱼和"鲸娘"桌宠。
  - 可以侧载到电视盒子上跑，但它是**按触屏手机设计的**：没有遥控器焦点导航，D-pad 基本点不动；鲸娘只是桌宠，没有办公室场景；长按 OK 开聊天做不到。
  - ⚠️ 它的鲸娘/品牌素材**保留所有权利**（`ASSETS.md` 明说），不能抠出来打进自己的 APK；代码 AGPL。
- 建议：**先花 10 分钟装个 DSH Go 到盒子上看看**（GitHub Releases 直接下 APK），直观感受"电视上有个鲸鱼娘"是什么样。

### 2）有一个现成的 TV APK，但没有办公室
- **[thuyqpham/dsh-tv](https://github.com/thuyqpham/dsh-tv)**（MIT，2026-11-09 建仓）：电视语音终端 + 鲸鱼娘动画 + D-pad 控制，反向控制宿主机。
  - 实测评估（详见 `research/dsh-tv.md`）：只有 1 个 commit、无 Gradle、`classes.dex` 89KB；**没有办公室/多会话可视化**；OK 键被写死成"提前发送"，**没有长按**；ASR 靠宿主机 SenseVoice；APK 9.4MB 里 97% 是 6 段宠物动画。
  - 结论：**不值得 fork**（改造成本 > 自建），但它的"宿主机跑 ASR、TV 只录音"的设计可以抄，见第六节。
- 结论：**没有「办公室 + 遥控长按 + 电视 UI」三合一的现成 APK。**

### 3）"办公室"这个品类已经卷了，但全是浏览器插件
| 项目 | 是什么 | 能直接上电视吗 |
|---|---|---|
| [Thunderunruly/agent-office](https://github.com/Thunderunruly/agent-office)（npm `dsh-pixel-office`，MIT） | DSH 插件：所有会话变成一栋写字楼，楼层=工作区、办公室=会话，灯光=是否在干活；**零图片，纯 Canvas 程序化绘制** | ❌ 网页插件，DSH Web 要 token、整个 UI 是 IDE，遥控器没法用 |
| [harishkotra/agent-office](https://github.com/harishkotra/agent-office)（408★，MIT） | 独立像素办公室：Phaser+Colyseus+Ollama，小人自己走路/开会/招人 | ❌ 浏览器 Web 应用，语音/移动端/TV 都在 roadmap |
| [wyx135230/DeepSeek-Office](https://github.com/wyx135230/DeepSeek-Office)（Apache-2.0） | 唯一叫 "DeepSeek Office" 的项目：Three.js+Phaser 2.5D 办公室 | ❌ DSH Web 插件，需 WebGL，明确不做移动端 |
| [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)（10.1k★，MIT） | VS Code 插件，办公室贴图最全（角色/地板/家具） | ❌ 只是素材库，可借用 |
| 还有 reymondmeking / zhxu8977 / Lingxi-AI / 0xMoji / xx-ytg 等一批 DSH 像素办公室插件 | MIT 居多 | ❌ 全是 Web 插件 |

### 结论
> **没有现成的电视版 DeepSeek Office**。但零件齐全：真实状态（DSH 本地投影缓存）、办公室 UI 思路（开源插件）、鲸鱼娘动画（MIT 素材）都有现成来源；缺的是"电视壳 + 遥控长按交互"。这轮我直接做了一个能装的原型。

### 鲸鱼娘素材：用哪套、授权怎么算
- ✅ **本项目使用**：`dsh-dafeiyu` 插件自带素材（你本机就有），**16 组动作 × 每组 241 帧 × 24fps × 412×344**，MIT；上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 同样 MIT。保留版权声明即可自用/再发布。
- ✅ 备选（同样干净）：`chenthreegold/deepseek-whale-pet`（MIT，可代码重绘）、`regrevia/pocket-harness`（MIT，20+ 姿势）、`1tryout/dsh-whale-pixel-pet`（MIT，106 段 VP9 webm，适合大屏视频式播放）。
- ❌ 不要用：DSH Go 的鲸娘（保留所有权利）、`WenQ-cloud/dsh-cutewhale-h`（美术 CC BY-NC-SA，禁商用）、GHSYES 的 GIF（BSD-3 声明与 DSH-TUI 权利声明冲突）。

---

## 二、架构（已按你的选择：Mac 当大脑、TV 当瘦客户端）

```
┌──────────────────────── Mac ────────────────────────┐
│  DeepSeek Harness（你平时用的那个，不需要改）         │
│      └─ ~/.dsh/storages/session_projcache/*.json    │
│              │ 只读：标题 / 是否在跑 / 第几步 / 团队  │
│              ▼                                       │
│  bridge（Node 22+，零依赖）                          │
│   ├─ /tv             全屏办公室网页（WebView 打开）  │
│   ├─ /api/state      2 秒一次的真实状态               │
│   ├─ /api/chat       鲸鱼娘解说 / 对话                │
│   ├─ /pet/*          鲸鱼娘逐帧动画（本机素材）       │
│   └─ UDP 8766        电视端自动发现，不用手输 IP      │
└──────────────────────┬──────────────────────────────┘
                       │ 局域网 HTTP
┌──────────────────────▼──────────────────────────────┐
│  电视盒子 APK（约 3~5 MB）：                          │
│  全屏 WebView + 遥控按键 + 中文 TTS + 常亮 + 断网重试  │
│  短按 OK=戳一下      长按 OK(600ms)=和鲸鱼娘聊聊       │
└─────────────────────────────────────────────────────┘
```

为什么这样选：

- **不直接把 DSH 网页投到电视**：DSH Web 需要 launch token、整个界面是 IDE，像素办公室只是侧边栏一个面板；电视遥控器在网页里没法用。
- **状态从 `session_projcache` 读**：这是 DSH 自己写在本地的投影缓存（只读、不改 DSH、不需要 token/插件）。实测里面有：会话标题、`turnBoundary`（这一轮/这一步是否在跑）、`agentTeam`、`subagentCatalog`、`todos`、cwd、最后活跃时间——正好够画一个"办公室"。
  - ⚠️ 一个实测坑：`sessionStats.openStep` 在步骤进行中经常是 `null`，不能用来判断"正在跑"；必须看 `turnBoundary.openTurnStartSeq != null`（详见 `research/tv-android.md` 与 bridge 实现）。
- **TV 端用 WebView 而不是原生 Canvas**：像素风 2D + 逐帧动画 WebView 完全够；**改画面不用重装 APK**（网页在 Mac 上改完电视刷新就生效），APK 只有几 MB。代价是首次启动依赖局域网。
- **长按 OK 必须在原生层做**：WebView 收不到电视遥控按键（焦点在网页里），要 Activity 的 `dispatchKeyEvent` 截获后经 JS 桥转发。

---

## 二·五、UI 为什么用网页技术栈？要不要把页面嵌进 APK？

其实**这套 UI 本来就是网页技术栈**：页面上所有东西都是 HTML + Canvas 2D（办公室是程序化绘制的 Canvas，鲸鱼娘是逐帧 `<img>`/`drawImage`），APK 只是一个 `WebView` 壳，负责遥控按键、TTS、常亮和断网重试。所以问题不是"要不要用网页"，而是**"页面放哪儿"**。

| 方案 | 好处 | 代价 |
|---|---|---|
| **A. 现在：页面放在 Mac，APK 只做壳** | APK 只有 **61 KB**；改画面/改文案不用重装 APK（Mac 上改完电视刷新就生效）；鲸鱼娘 240MB 素材不用进 APK | Mac 不开机/断网时只有重试浮层，没有画面 |
| **B. 页面打进 APK（assets/web）** | 断网也有画面；启动更快 | 改 UI 要重新打包安装；要自己维护版本一致 |
| **C. 完全离线自治（状态+模型都在盒子）** | 彻底不依赖 Mac | 拿不到 DSH 真实状态，等于另做一套产品；2GB 盒子也不适合跑模型 |

**建议的下一步（改动很小）**：做 **A+B 混合**——
- APK 里内置一份精简页 + 3~5 个鲸鱼娘动作（10~20MB），Mac 不在线时显示"小鲸鱼在等你下班"的离线画面，不再只有干巴巴的浮层；
- Mac 在线时加载 Mac 上的完整页（保持热更新）。

这样既保留"改 UI 不用重装"，又不会出现"电视上只剩一个报错页"的尴尬。要我现在就把离线兜底页加上也行，大概半小时的活。

---

## 三、电视上你会看到什么

（原型截图：`assets/screenshot-web-1920.png`、`assets/screenshot-tv-emulator.png`）

- **6 个工位 = 6 个真实会话**：名字牌是会话标题，状态灯（绿=在干活、黄=等你确认、蓝=刚做完、灰=闲着、红=出错），头顶气泡显示"正在调用工具 · 第 26 步"，桌下 todo 进度条；有 teammates 的会话会多坐几个小人。
- **鲸鱼娘站在旁边**：状态联动播放 idle / 打哈欠 / 思考 / 敲键盘 / 成功 / 等待 动画——和桌面端是同一只。
- **短按 OK**：戳她一下，随机播"戳/摸头/摆尾" + 一句台词。
- **长按 OK（600ms）**：弹出"和鲸鱼娘聊聊"，三个大按钮（他们在忙什么？谁最努力？讲个办公室小故事），方向键选、OK 确认，她逐字说出来并朗读。
- **方向键**：在工位间移动观察光标，OK 让她介绍这个工位。
- **BACK**：先关面板；没有面板时显示"想退出吗？"（防止小孩误触退出）。
- 小孩子会一开几小时：页面做了 30fps 上限、静止降帧、每 1~2 分钟整体像素位移防烧屏。

---

## 四、遥控长按 OK 是怎么做稳的

国产盒子遥控器有两类行为：一类发 `onKeyLongPress`，一类只发 `repeatCount` 递增的重复 DOWN。三保险：

```java
// Activity.dispatchKeyEvent 里
case KeyEvent.ACTION_DOWN:
    if (repeatCount > 0) return true;              // 重复事件一律吞掉
    event.startTracking();                          // 让系统能派发 onKeyLongPress
    handler.postDelayed(longPressRunnable, 600);    // 兜底：600ms 到点直接触发
case KeyEvent.ACTION_UP:
    handler.removeCallbacks(longPressRunnable);
    send(longPressFired ? "long_ok" : "ok");        // 长按后松开不再补发短按
```

- 600ms 是"长按"和"点一下"的分界（比系统默认 ~500ms 更适合遥控）。
- `onKeyLongPress` 与定时器只认先到的那个，保证不触发两次。
- OK 键同时认 `DPAD_CENTER(23)` / `ENTER(66)` / `NUMPAD_ENTER(160)` / `BUTTON_A(96)` / `BUTTON_SELECT(109)`——不同遥控器/手柄上报的键码不一样，这是"有些盒子按 OK 没反应"的头号原因。
- BACK 永远只转发给网页、**绝不 finish()**——否则小孩一按就回桌面。

---

## 五、装到你的电视上（小米盒子5）

### 你的设备：小米盒子5（2025 款，HyperOS）
四核 A55 / **标准版 2GB+32GB**（Max 版 4GB+64GB）/ 4K 输出 / Wi-Fi 6 / 蓝牙 5.2 / **USB 2.0** / 内置小爱语音助手。
据此定的策略：
- **不用兼容老盒子**：HyperOS 的 WebView 是 Chromium 100+，页面可以直接用现代 JS/CSS；不用为 Chrome 58~74 降级。
- **按 2GB RAM 设计**：页面里鲸鱼娘用环形缓冲只解码前后几帧（不是 241 帧全载），静态背景只画一次，30fps 上限——2GB 盒子够用。
- **语音**：遥控器的麦克风键归小爱助手，第三方 App 拿不到（官方 API 明确 `KEYCODE_VOICE_ASSIST` 不投递给应用）；但盒子有 **USB 2.0**，插一个几十块的 USB 麦克风是最实际的路（见下一节）。

### 一次性准备
1. 盒子和 Mac 连**同一个 Wi-Fi**（不要访客网络/VLAN 隔离）。
2. Mac 上启动：`cd /Volumes/T7Shield/Project/deepseek-office-tv && ./tools/serve.sh`，它会打印 `电视地址: http://192.168.x.x:8765/tv`。
3. 小米盒子5 打开 ADB：
   - 设置 → 关于 → **产品型号连点 7 次** → 开发者选项 → 打开 **USB 调试** 和 **网络调试（ADB over LAN）**
   - 记下盒子 IP（设置 → 网络 → 已连接网络）
4. Mac 上：
   ```bash
   adb connect <盒子IP>:5555
   adb devices            # 看到 device 即可
   ```

### 安装
```bash
cd /Volumes/T7Shield/Project/deepseek-office-tv
adb install -r dist/app-debug.apk
# 首次启动会自己用 UDP 发现 Mac；发现不到就手动指定：
adb shell am start -n dev.dsh.office.tv/.MainActivity --es url http://<Mac的IP>:8765/tv
```
> 也可以把 `dist/app-debug.apk` 拷 U 盘插盒子，用"文件管理/当贝助手"安装。
> 小米盒子5 的 HyperOS 可能不显示非商店应用的图标：直接用上面的 `am start` 命令，或装一个当贝桌面把它露出来。
> 想让电视一开机就进办公室：HyperOS 对自启动限制较严，最稳的是当贝桌面的"开机启动"设置。

### 常见问题
| 现象 | 原因 | 处理 |
|---|---|---|
| 卡在"等 Mac 上的办公室上线" | 不同网段 / Mac 防火墙 | 先用手机浏览器打开 `http://<Mac IP>:8765/tv` 验证；关掉 Mac 防火墙对 node 的拦截 |
| 画面糊 / 只占一角 | 电视输出 4K + overscan | 页面按 16:9 自适应；盒子设置里把"画面比例"调成"点对点/全屏" |
| 长按 OK 没反应 | 遥控器长按不发系统长按事件 | 已用 600ms 定时器兜底；仍不行告诉我，把阈值调到 800ms |
| 没有中文朗读 | HyperOS 没给第三方 App 注册中文 TTS 引擎 | 先看字幕；语音路线见第六节 |
| `INSTALL_FAILED_...` | 签名冲突/空间不足 | `adb uninstall dev.dsh.office.tv` 再装；`adb logcat | grep PackageManager` |
| 应用被系统杀 | HyperOS 内存/省电策略 | 保持在办公室页面（前台 Activity）即可；不要切后台 |

---

## 六、语音怎么做（分阶段，从便宜到贵）

### 阶段 0：让她会说话（v1 已做，已升级成"好听的声音"）
- 已接 **edge-tts 中文神经语音**（微软，免费、个人使用）：`bridge` 新增 `GET /api/tts?text=...`，返回 mp3 并**磁盘缓存**；网页优先播这个，失败再回退 Android 系统 TTS。**APK 体积不变**，换音色只要改 `bridge/config.json` 的 `tts.voice`。
- 默认音色 **`zh-CN-XiaoyiNeural`（活泼少女，最贴鲸鱼娘）**；可选 `XiaoxiaoNeural`（温柔）、`YunxiaNeural`（可爱男声）、`liaoning-XiaobeiNeural`（东北味）——试听文件在 `assets/voice-samples/`。
- 已把 45 句固定台词（戳/摸头/摆尾/问候/面板提示）预生成进缓存（约 1.2MB），**Mac 就算断网，这些台词也能秒出**。
- 为什么**不把语音包塞进 APK**：神经网络语音模型动辄 45~131MB（sherpa-onnx VITS），而你有 Mac 在跑 bridge，把语音放 Mac 端既小又快；真要离线自治，再打 sherpa-onnx 模型包。
- 安装语音引擎：`./tools/setup-tts.sh`（装到 `~/.dsh-office-tts/venv`）；没装也能用，只是回退系统 TTS / 字幕。

### 阶段 0.5：验证遥控器麦克风能不能用（已加进 APK）
- Android 的 `RecognitionService` 允许 App **"借壳"**：弹出系统"请说话"界面，用户对遥控器说话，系统把识别文字返回给我们——这种情况下用到的就是遥控器麦克风。
- 面板里加了第 5 项 **「🎤 试一下语音（遥控器麦克风）」**，点一下就知道结果：
  - 弹出识别界面并返回文字 → 你的遥控器麦克风可以直接给鲸鱼娘用；
  - 「这台电视没有系统语音识别」→ 小米 HyperOS 没给第三方留服务，走下面阶段 2；
  - 取消/超时 → 正常行为，可再试。
- 实测：模拟器上走的是"没有系统语音识别"分支（符合预期）；**真盒子结果待你点一下确认**。

### 阶段 1：让小朋友能"打字"（成本最低，建议先做）
- 电视遥控没有输入法，`EditText` 在 TV 上弹不出键盘。做法：**手机扫码打开一个输入页** → 文字经 bridge 送到电视，鲸鱼娘念出来。不需要麦克风权限，体验立竿见影。

### 阶段 2：语音输入（真正的难点）
**先泼冷水**：电视遥控的麦克风键被系统/厂商助手独占，官方文档明确 `KEYCODE_VOICE_ASSIST` **"Not delivered to applications"**；遥控器麦克风的音频也不会给第三方 App；国产盒子基本没有 `RecognitionService`。所以"按住遥控器说话"做不到。
可行的三条路：
1. **USB 麦克风 + `AudioRecord` 16kHz PCM + 云端流式 ASR**（研究推荐 v2 主路线）：几十块的 USB 麦插盒子，固定位置、免配对；VAD 断句；端到端 300~800ms。
2. **手机当麦克风**（companion 网页/App 推 PCM 给 bridge）：零硬件成本，顺便解决"没有键盘"；适合"旧手机固定放电视旁"。
3. **抄 dsh-tv 的做法**：TV 只录 16kHz WAV（20ms 帧 + 能量 VAD + ~900ms 尾静音）POST 给宿主机，宿主机用 DSH 同款 **SenseVoiceSmall ONNX**（`~/.dsh/speech-to-text/sensevoice/models/sensevoice-onnx`）识别，失败回落 mlx-whisper。**低端盒子不吃模型，只解码录音**——这条最适合我们这种"Mac 当大脑"的架构，直接复用。
- 可选：`sherpa-onnx` 离线 ASR/TTS 兜底（模型 45~131MB，首版不做）。

### 阶段 3：唤醒 + 连续对话
"小鲸鱼"唤醒词 + VAD + 打断。参考 `regrevia/pocket-harness`（MIT，edge-tts + Whisper/SpeechRecognizer + 唤醒词，自带手机 APK）。

---

## 七、隐私与安全

- bridge **只读** DSH 投影缓存（标题、cwd、状态、todo、团队名），**不读会话正文、不写任何 DSH 数据、无遥测、不上传**。
- API Key 只在 Mac 环境变量/`config.json`，**不下发电视**；电视端没有任何键盘输入，不会误发消息。
- 局域网明文 HTTP，仅限家庭网络；后续可加一次性 token（dsh-tv 的 pair 协议可参考）。
- 页面不加载任何外部资源（字体、图片全部本地/程序化），断网也只影响状态刷新。

---

## 八、目录与命令

```
/Volumes/T7Shield/Project/deepseek-office-tv/
├── PLAN.md                  # 本文件
├── CONTRACT.md              # 前后端接口契约（冻结）
├── bridge/                  # Mac 端服务（Node 22+，零依赖）
│   ├── server.mjs           # HTTP + UDP 发现 + 静态资源 + /api/tts
│   ├── state.mjs            # projcache → 办公室模型
│   ├── chat.mjs             # 鲸鱼娘解说/对话（无 key 也能用）
│   ├── tts.mjs              # edge-tts 中文语音（磁盘缓存）
│   ├── assets.mjs           # 鲸鱼娘帧服务
│   └── web/                 # 电视网页（index.html/app.js/style.css）
├── tv-app/                  # Android TV APK（Gradle，Java）
├── tools/                   # serve.sh / install-apk.sh / check.sh / setup-tts.sh
├── assets/                  # banner / 图标 / 截图 / 语音样本
├── dist/app-debug.apk       # 可直接安装的 APK
└── research/                # 生态调研 + Android TV 调研 + dsh-tv 拆解
```

```bash
# 1. Mac：起服务（自动打印电视地址）
cd /Volumes/T7Shield/Project/deepseek-office-tv && ./tools/serve.sh

# 2. 浏览器预览（不用电视也能调）
open http://localhost:8765/tv

# 3. 重新构建 APK（可选）
cd tv-app && ./gradlew assembleDebug

# 4. 装到电视
./tools/install-apk.sh <盒子IP>
```

可选：`export DEEPSEEK_API_KEY=sk-...` 后，长按对话走真实模型（不设也能用，纯本地解说；人设见 `bridge/chat.mjs`）。

---

## 九、验证记录（本机实测）

| 项目 | 结果 |
|---|---|
| bridge `/api/state` | ✅ 真实数据：12 个会话 / 2 个在跑 / 2 位同事；本会话显示 `working · 第 71 步 · 正在调用工具` |
| bridge `/api/chat` | ✅ 无 API Key 时 narration：「办公室里有 2 位小伙伴在忙哦。「分析APK体积并优化」已经忙了 2 分钟啦…」；配了 key 走真实模型，失败自动降级 |
| 网页 1920×1080 / 1280×720 | ✅ 真实数据下渲染正常、无 console error（截图见 `assets/screenshot-web-*.png`） |
| 短按 OK → 戳一下 | ✅ 鲸鱼娘随机播放摸头/戳/摆尾 + 台词气泡（「呼噜呼噜…好舒服。」） |
| 长按 OK → 对话面板 | ✅ 面板打开、方向键选、OK 确认、逐字显示回答并调 TTS（浏览器里降级为字幕） |
| APK 构建 | ✅ `./gradlew assembleDebug` → `dist/app-debug.apk`（约 48KB，debug 签名） |
| APK 安装/启动 | ✅ 模拟器（1920×1080 TV 镜像）`adb install` + `am start` 成功 |
| 遥控按键 | ✅ 短按 `ok`、按住 900ms `long_ok`、`input keyevent --longpress` 也识别 `long_ok`、BACK 只回页面不退出、方向键/菜单/`BUTTON_A`/`BUTTON_SELECT`/`ENTER` 都验证（11 项全过） |
| 断网重试 | ✅ 停掉 bridge 后出现"找不到 Mac 上的办公室，正在重试…"，恢复后自动回页面，不白屏 |
| UDP 自动发现 | ✅ 盒端广播 → bridge 回 `DSH_OFFICE_TV!http://…` → 写入 SharedPreferences 并加载 |
| 渲染进程被杀 | ✅ `onRenderProcessGone` 重建 WebView，不崩 |
| 语音测试按钮（遥控器麦克风） | ✅ 面板第 5 项可点；模拟器弹出系统识别 UI（`com.google.android.tts`），取消/20s 超时/无识别服务三种分支都有正确文案且不崩；成功分支用 CDP 注入验证「我听到你说：…」 |
| 好听的中文语音 | ✅ `edge-tts`（`zh-CN-XiaoyiNeural`）生成 48kbps mp3，`/api/tts` 200；WebView logcat：`tts: playing /api/tts audio (9 chars)`；`TTS_ENABLED=0` 时自动回退 `native speak` |
| 固定台词离线可用 | ✅ 45 句预生成进 `~/.dsh-office-tts/cache`（约 1.2MB），Mac 断网也能秒出 |
| 真机 | ⏳ 需要你在小米盒子5 上装一次（我这边只有模拟器；有问题把 `adb logcat` 发我） |

## 十、已知限制 / 下一轮

- **Mac 必须开机**（"Mac 当大脑"的代价）。要脱离 Mac，得把状态和模型搬进盒子，是另一套架构。
- **电视上没有文本输入**：v1 只用预设问题 + 方向键（有意为之，遥控器打字是灾难）。
- **错误状态**：DSH 的报错不一定写进投影缓存，红灯状态只能尽力而为；等待审批暂时用 `userQuestions` 推断。
- **只显示最近活跃**：24 小时窗口、每个工作区最多 6 个工位（避免旧会话淹没办公室），多楼层分页是下一轮。
- **真机未验证**：模拟器是 x86/arm64 image，真盒子 HyperOS 的遥控键码/音频通路可能还有差异。
- 下一轮：手机扫码输入 → USB 麦克风 + SenseVoice ASR（宿主机跑，盒子只录音）→ 家长密码/时长限制 → 多楼层 → 局域网 token → 开机自启。

## 十一、许可与致谢

- 鲸鱼娘动画：[QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT）→ 上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT），保留版权声明。
- 灵感与参考：[harishkotra/agent-office](https://github.com/harishkotra/agent-office)、[Thunderunruly/agent-office](https://github.com/Thunderunruly/agent-office)、[pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)、[thuyqpham/dsh-tv](https://github.com/thuyqpham/dsh-tv)（借鉴其宿主机 ASR 思路）。
- 本项目为个人/家庭自用原型，**非 DeepSeek 官方产品**；不使用 DeepSeek 官方 Logo；"DSH 办公室"仅作项目代号。
