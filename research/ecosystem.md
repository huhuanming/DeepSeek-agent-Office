# 生态调研：有没有现成的 "DeepSeek Office"？

> 调研时间：2026-11-10（北京时间）· 调研对象：DSH（DeepSeek Harness）生态、GitHub、npm、DSH 插件市场
> 用途：判断「像素办公室 + DSH 鲸鱼娘 + Android TV APK」这套东西是否已有现成实现，能复用什么。

---

## 0. TL;DR（结论先行）

1. **没有**任何项目同时做到「像素办公室场景 + DSH 鲸鱼娘 + Android TV APK + 长按 OK 交互」。
2. **但三块拼图已经各自存在，而且许可相对干净**：
   - **TV/APK + 鲸鱼娘 + 语音**：`thuyqpham/dsh-tv`（MIT，2026-11-09 建仓，0★，已发 `v0.1.0` Release，含 `TVAssistant.apk`）——本质是「Android TV 语音终端」，**没有办公室场景**，OK 键是"提前发送"而非长按开聊天。
   - **办公室场景**：`Thunderunruly/agent-office`（npm `dsh-pixel-office`，MIT）——**全部美术由 Canvas 代码画出来、零图片文件**，最适合搬到独立 App；`wyx135230/DeepSeek-Office`（Apache-2.0，2.5D 办公室）与 `pixel-agents-hq/pixel-agents`（MIT，10.1k★，素材最全）是另外两条素材来源。
   - **鲸鱼娘素材**：`chenthreegold/deepseek-whale-pet`（MIT）、`regrevia/pocket-harness`（MIT，且自带 Android APK + 语音）、`1tryout/dsh-whale-pixel-pet`（MIT，106 段 VP9-alpha 动画）——这三家是**可直接合法使用**的鲸鱼娘。
3. **"dsh go" 的真相**：用户说的 "dsh go" 是 **`ccch1mneyyy/dsh-go`，DSH 的 Android 客户端**（Flutter，AGPL-3.0，Android 8+，手机 APK）。它确实内置两只像素宠物：**Deepy 小鲸鱼** 和 **鲸娘（whale-girl）**。但 **鲸娘美术不在 AGPL 授权范围内**：`app/assets/pets/whale-girl/pack.json` 里写明 `"author": "DSH-TUI"`、`"license": "DSH-TUI 吉祥物，作者授权 dsh-go 使用"`，仓库 `ASSETS.md` 明确"版权归 ccch1mneyyy（DSH-TUI）所有，保留所有权利……以修改版身份发布请换成自己的名称和素材"。
   → **直接把 DSH Go 的鲸娘精灵图抠出来打进自己的 APK（尤其要分发）在法律上不成立，需要作者书面授权。**
4. **不存在名为 "DeepSeek Office" 的独立 APK**。唯一叫 "DeepSeek Office" 的项目是 `wyx135230/DeepSeek-Office`，它是 **DSH Web 插件**（Three.js + Phaser，2.5D 办公室，Apache-2.0 代码），不是独立 App，也没有 TV 版。
5. ⚠️ **命名坑**：`coeasy/dsh-go` 不是那个 Android App，而是「DSH 包管理器 + Registry + Marketplace」（MIT，22★）；`saya-ch/dsh-mobile`（Apache-2.0，801★）与 `kelai141/dsh-mobile-apk`（MIT，1061★）又是另外两个手机端方案。三者与 `ccch1mneyyy/dsh-go` 无关。

**结论**：想要的那个东西现在没有成品，但**路线 B（dsh-tv 的 TV 壳 + dsh-pixel-office 的代码美术 + MIT 鲸鱼娘素材）大约是 5–10 人日**就能出第一版可在电视上侧载的 APK。

---

## 1. 先分清楚三个 "dsh go" / 三个 "mobile"

| 名字 | 实际是什么 | 技术栈 | 许可 | 和本项目的关系 |
|---|---|---|---|---|
| [`ccch1mneyyy/dsh-go`](https://github.com/ccch1mneyyy/dsh-go)（用户口中的 "dsh go"） | **DSH 的 Android 客户端**，手机本地跑 DSH 引擎，也可遥控电脑上的 DSH；官网 `go.dshtui.com` | Flutter + Kotlin，Android 8+，arm64/x64 APK | **AGPL-3.0**（`sdk/`、`examples/` 为 MIT）；**Deepy / 鲸娘 / 品牌素材不授权** | 鲸鱼娘形象的"出处"，但素材许可不可直接复用 |
| [`coeasy/dsh-go`](https://github.com/coeasy/dsh-go) | DSH 生态的**包管理器 + Registry/Distribution + Marketplace**（导航站 `dsh-go.pages.dev`） | TypeScript | MIT | 无关，名字撞车 |
| 用户任务里的 "dsh go" 官网 | `https://go.dshtui.com/`（DSH Go 下载页） | — | — | 同上 |

补充：DSH 生态规模已很大——`https://www.dsh.so/` 自报收录 **25,533** 个插件，`https://awesome-dsh-plugin.com/` 自报 **9,714** 个。所以"像素办公室""鲸鱼娘"都已经不是蓝海，而是一片小内卷。

---

## 2. 关键事实：DSH Go 的鲸娘素材长什么样、许可怎么写的

`ccch1mneyyy/dsh-go`（master 分支）里鲸娘宠物包的实体：

```
app/assets/pets/whale-girl/
  idle.png  thinking.png  typing.png  music.png  conducting.png  building.png
  carrying.png  error.png  happy.png  notification.png  compacting.png
  sleeping.png  waking.png  poke-left.png  poke-right.png  tickle.png
  drag.png  swim.png  smile-hearts.png  thumbs-up.png  idle-look.png  idle-spout.png
  pack.json                     # schema 1，含 canvas/锚点/命中框/逐帧毫秒
app/tool/pet_src/whale-girl/index.html   # = dshtui.com/pets/whale-girl-emoji/ 原页面快照
```

- 格式：**每动作一张横向精灵条**，例如 `idle.png` 是 **676×49**，`frameW=52, frameH=49, cols=13`；`pack.json` 里 `canvas: 69×66`、逐帧 `{"i":0,"ms":700}...` 与时序全部给出。Deepy 则是 `idle.png 3780×240`（378×240 一帧，10 列）。
- `pack.json` 原文：
  ```json
  "author": "DSH-TUI",
  "license": "DSH-TUI 吉祥物，作者授权 dsh-go 使用",
  "source": "https://dshtui.com/pets/whale-girl-emoji/"
  ```
- 仓库 `ASSETS.md`：DSH Go 源码 AGPL-3.0，但**品牌与美术素材不在 AGPL 内**，"你可以为了构建、测试和运行本仓库而使用它们。如果你以修改版或衍生作品的身份再发布，请换成自己的名称和素材"。

**判定**：这是「授权给 dsh-go 这一款 App」的许可，不是开源美术许可。个人给自家孩子侧载、不分发，风险相对低但仍属复制使用；**一旦要发布 APK（哪怕免费），必须换素材或拿到作者授权**。

---

## 3. 办公室类项目

### 3.1 `harishkotra/agent-office`（408★，MIT）——上游灵感项目，Web Only

- **是什么**：自生长 AI 团队的像素办公室。每个 Agent 有 Ollama 大脑，15s 思考一次，会走到工位、互相聊天、招实习生、派任务、执行代码/搜索、记忆持久化。
- **架构**：pnpm workspace 五个包
  - `packages/core`（Agent 状态机 / Office 网格 / 任务 / 记忆）
  - `packages/adapters`（OllamaAdapter、OpenAICompatibleAdapter、PromptBuilder）
  - `packages/server`（Colyseus Room + ToolExecutor + SQLite MemoryStore）
  - `packages/ui`（**Phaser 3.80 + React 18**，Chat/TaskBoard/Inspector/SystemLog/LayoutEditor）
  - `packages/cli`；`docker-compose.yml`（server:3000 / ui:80 / Ollama / Redis）
- **是否独立 App**：是独立 Web 应用（`http://localhost:5173`），**不是 DSH 插件**，与 DSH 无关，只用 Ollama 或任意 OpenAI 兼容 API。
- **许可**：**MIT**（`Copyright (c) 2026 Harish Kotra`）。
- **移动/TV/语音**：README Roadmap 明写 **`[ ] Voice mode (TTS/STT)`、`[ ] Mobile companion app` 均未实现**；无触屏/TV/D-pad 适配；没有 Android 工程。
- **可复用资产**：`packages/ui/public/assets/characters/char_0..5.png`、`characters.png`（160×36）、`agent.png`；另外还把整份 `pixel-agents-repo/`（含 floors/furniture/walls）**vendored 进了仓库**。两套都是 MIT 谱系，但仓库体积 659KB、无鲸鱼娘。

### 3.2 `Thunderunruly/agent-office` / npm `dsh-pixel-office`（MIT）——最贴近"DSH 办公室"的实现

- **是什么**：DSH 的"固定像素办公室大楼"：workspace = 楼层、session = 办公室、Agent Team = 楼里的人；亮灯表示在干活。三级缩放（整栋楼 → 楼层 → 房间），点谁打开哪个会话。
- **形态**：**纯 DSH 插件**（Host 半 `index.js` + Client 半 `client.js` + `cordis.patch.yml`）。
- **安装**：`dsh plugin --profile desktop add dsh-pixel-office`，或插件市场搜索 "Pixel Office"，或源码目录 `install_bundle <路径>`；要求 DSH ≥ 0.2.1-rc.3。
- **技术栈**：无构建系统；`scripts/build.mjs` 把 `src/*.js` 拼成单文件 `client.js`；Host 侧只读 DSH Client 插件可见的**会话/工作区快照**（`sessions.list` / `workspaces.list` / `agentTeam` 投影），只写一个 `localStorage` 键 `dsh.pixel-office.display.v1`，无网络、无遥测。
- **关键点（利好复用）**：**仓库里没有任何图片素材**。美术全在 `src/art-core.js`(78KB)、`art-city.js`(91KB)、`art-building.js`(47KB)、`art-room.js`(51KB) 里，由 `<canvas>` 2D 逐像素程序化绘制；文件头注释明确 "**no images, no shadowBlur, no gradients**"，16×24 像素小人 + 家具套件，确定性（`artRng`/`artHash`，不用 `Math.random`）。这些函数是**纯函数、只收 `CanvasRenderingContext2D`**，可以整段搬进任何独立 Web/Phaser/WebView 项目。
- **能否直接当独立 App**：不行。`client.js` 依赖 DSH 的 `window.__ModuleLoader__`、React 宿主 primitives（`@deepseek-ai/dsh-client-ui-primitives`）与各 `dsh-api-*` 注入；数据模型 `src/model.js` 读的是 DSH 快照。**要独立跑，得自己写"数据源"层**。
- **许可**：MIT（含美术，因为是代码生成的）。
- **移动/TV/语音**：无。README 明说 read-only 可视化，不能发消息/审批。

### 3.3 `wyx135230/DeepSeek-Office`（Apache-2.0，17★）——唯一叫 "DeepSeek Office" 的项目

- **是什么**：DSH 上的 **2.5D 沉浸式办公室**模拟（建团队、开会、咖啡角、放映室、场景内手机聊天、AI 装饰）。
- **形态**：**DSH Web 插件**（npm 包名 `deepseek-office`），基于 `Fei2411/DeepSeek-Bot`（DS Bot）fork。
- **技术栈**：**Three.js + Phaser**（3D 场景 + 2D 逻辑），`client.js` 生成后提交；**要求 WebGL**；README 明说 "**mobile devices are not the primary target yet**"，无 TV。
- **许可**：**代码 Apache-2.0**；素材混合：角色/电梯/电视 3D 模型为作者自备（`SOURCES.md` 记录来源）、Momo 用 **CC0 Ninja Adventure**、保留的 LPC 素材按各自许可（LPC 通常 CC BY-SA）。**不是像素风**，是 3D 低模。
- **可复用**：架构与"对话/会议"交互设计可参考；3D 模型不宜直接搬（许可分散）。

### 3.4 其他 DSH 像素办公室插件（说明"这个品类已经卷了"）

GitHub 搜索 `pixel office dsh` 共 10 个仓库，另有多个独立实现，均为 **DSH Web 插件、无独立 App**：

| 仓库 | 说明 | 许可 |
|---|---|---|
| [`reymondmeking-dot/dsh-office`](https://github.com/reymondmeking-dot/dsh-office) | 多 Agent 像素办公室桌面 UI（Win/Linux/macOS） | MIT |
| [`zhxu8977/dsh-pixel-office`](https://github.com/zhxu8977/dsh-pixel-office) | 宝可梦像素办公室，多办公室/早会 | MIT |
| [`guijinb666/dsh-pixel-office`](https://github.com/guijinb666/dsh-pixel-office) | 每个会话一只像素小人进门坐下打字 | 无 LICENSE |
| [`Lingxi-AI-cn/dsh-pixel-office`](https://github.com/Lingxi-AI-cn/dsh-pixel-office) | 无障碍像素办公室 | MIT |
| [`0xMoji/dsh-agent-office`](https://github.com/0xMoji/dsh-agent-office) | 全局像素办公室可观测 | MIT |
| [`xx-ytg/dsh-agent-office`](https://github.com/xx-ytg/dsh-agent-office) | 活的像素办公室 | MIT |

### 3.5 `bagidea/bagidea-office`（261★，MIT）——"桌面壁纸办公室"，非 DeepSeek

Claude Code agents 在**桌面壁纸**上生活/工作/委派，MIT。是"办公室常驻桌面"这一形态最成熟的开源参考（不含鲸鱼娘、非 DSH）。

---

## 4. 鲸鱼娘 / 桌宠类项目（含素材许可与文件路径）

### 4.1 `ccch1mneyyy/dsh-go` → 见第 2 节（**素材不可直接复用**）

### 4.2 `thuyqpham/dsh-tv`（MIT，0★，2026-11-09 建仓）——**唯一现成的 Android TV APK**

- **是什么**：**Whale-chan**，把 Android TV 盒子变成 DSH 的语音终端。遥控器一键说话 → 局域网宿主机（Mac）上的 DSH headless 会话 → 鲸鱼娘动画 + TTS 念回复；还能反向控制 TV（D-pad/OK/Back/Home、启动任意 App、输入文字、截图）。
- **形态**：**一个 APK 内含两半**：TV Bridge（无障碍服务注入按键）+ Whale-chan 助理 UI（Java，`com.jp.dshtv`）；另有可选"Disney+ 按键 shim"APK；配 DSH 插件 `plugin/ui`（设置面板扫 LAN 找 TV、生成配对二维码）。
- **Release**：`v0.1.0` **已包含 `TVAssistant.apk` + `DisneyShim.apk` + `v0.1.0.zip`**（debug 签名，内置 `WHALE_TOKEN=pair-me`，二维码配对换真 token）。
- **技术栈**：Java + 原生 View（Leanback TV）、QR 配对、SenseVoiceSmall ONNX（sherpa-onnx，Apache-2.0）做 STT、Whisper 兜底、`host/whale_voice.py`（Python 3.10+，8766 端口）做配对/STT/DSH 会话、`host/dshtv.py` 做 TV bridge CLI；要求 Android TV 9+（实测 onn. 4K Pro / Android 14）。
- **素材**：`android/tv-assistant/res/raw/whale_{idle,busy,think,wave,celebrate,wilt}.webp`（**6 段透明动画 WebP，1.2–1.9MB/段**）+ `ic_whale.png`；来自 **`1tryout/dsh-whale-pixel-pet`（MIT）**（WebM 转换），早期版本用 **`Er1c0v0/dsh-whale-pet`（人物美术 CC BY 4.0）**；App 图标用了 DeepSeek 鲸鱼 emblem，`THIRD-PARTY.md` 明说**不在 MIT 内、正式分发前需替换或取得许可**（仓库另提供原创 `brand/deepseek-tv-whale.svg` MIT 替代）。
- **和需求的差距**：① 没有"办公室"场景（只有一只宠物浮层 + 气泡）；② **长按 OK 开聊天没有实现**（现状：OK=提前结束收音发送、Back=取消）；③ 强依赖局域网宿主机跑 DSH，不是 TV 本地自治；④ 只有 0★、单人维护、1 天大的仓库，处于"能跑的原型"阶段；⑤ 没有 mouse 交互（TV 端本就无鼠标）。
- **结论**：**这是最值得抄的 TV 底座**，许可 MIT，改造成"办公室 + 长按 OK 聊天"是工作量最小的路线。

### 4.3 `regrevia/pocket-harness`（npm `dsh-pet-voice`，MIT，1★）——**APK + 语音 + 鲸鱼娘的完整先例**

- **是什么**：「鲸灵」——手机扫码配对后，悬浮窗里住着像素鲸鱼娘；喊「鲸灵」派活，回复边生成边念；切项目/换人设全靠嘴。
- **形态**：DSH Host 插件（在 `webServer` 挂 `/pet-voice/`，带 token 的页面 + JSON/SSE/长轮询）+ **30MB Android 自签 APK**（Kotlin，零 androidx，悬浮窗 + 常听麦克风 + 语音唤醒）+ PWA（`manifest.webmanifest`，portrait）。
- **语音栈**：TTS 默认微软 `edge-tts`（免 key）；ASR 默认手机系统 `SpeechRecognizer`，可选本机 openai-whisper；唤醒词「鲸灵/小鲸/嗨鲸灵/hey whale/hello whale」；三种连法（局域网/自建域名/中转）。
- **许可**：**代码与文档 MIT，README 明写"像素素材由本项目生成，同样 MIT"**。
- **素材路径**：`android/app/src/main/assets/aster/{casual,maid}/pose_*.webp`（每张约 30KB，闭眼/睁眼两版，>20 个姿势：approve/happy/point/pout/shrug/shy/surprise/think/wave/closeup），由 `scripts/build-aster-assets.py`、`scripts/build-aster-v3.py`、`scripts/gen-pet-asset.mjs` 生成。
- **和需求的差距**：**手机竖屏悬浮窗**，不是 TV 全屏；没有办公室；不能横屏/遥控器操作。

### 4.4 `GHSYES/dsh-whale-girl-pet`（MIT 代码 + BSD-3 美术，3★）

- **形态**：**DSH Desktop 宿主插件 + 独立 Electron 透明置顶窗口**，Windows 10/11 x64 专用。
- **技术栈**：`index.js`（ESM 宿主插件：状态机 + HTTP `/whale-pet/*` + Electron 进程管理）、`runtime.js`（自动下载 Electron 44.0.0）、`desktop/main.js`（透明无边框 `alwaysOnTop('screen-saver')`、跳过任务栏）、`standalone.js`（Ctrl 拖动、左右脸判定、三连击）。
- **素材**：`assets/gifs/01-idle.gif` … `22-thumbs-up.gif`，**22 张像素 GIF**（约 67KB–298KB/张），`assets/catalog.json` 索引。
- **许可**：代码 MIT；**GIF 声称 BSD-3-Clause，署名 lhh010**（`THIRD-PARTY-NOTICES.md`），素材页 `https://dshtui.com/pets/whale-girl-emoji/`。
- **⚠️ 许可冲突**：DSH-TUI（`ccch1mneyyy`）对同一套"鲸娘"素材主张"保留所有权利、仅授权 dsh-go"，而本仓库主张 BSD-3。二手声明不能覆盖权利人声明——**再分发前应按权利人说法处理**。

### 4.5 `WenQ-cloud/dsh-cutewhale-h`（5★，MIT 代码 + **CC BY-NC-SA 4.0** 美术）

- **形态**：DSH Web/软件插件，鲸鱼娘住在输入框左侧；`client.js` 3.6MB（**贴图 base64 内联，仓库无独立素材文件**）。
- **许可**：**代码 MIT；像素素材 CC BY-NC-SA 4.0**——非商业、署名、相同方式共享。授权链：角色「溟月」= 上善无形 → 「女仆鲸鱼娘」= ZipZipPipe → 像素图 = Oo肥鱼O。
- **判定**：给孩子看的私人 App 勉强可用（署名 + 非商业 + 同协议共享），**一旦要商业化/广告/收费就不行**；而且素材是内联的，取出来要自己解包。

### 4.6 `chenthreegold/deepseek-whale-pet`（MIT，5★）——**许可最干净、可再生的鲸鱼娘**

- **形态**：两种——Codex 官方桌宠包 + Python/tkinter 独立透明置顶桌宠（`desktop_pet.py`）。
- **关键**：形象是**用代码逐像素手绘生成的**（`scripts/draw_pet.py`，底板 72×88、2× 最近邻放大），`scripts/build_atlas.py` 组图集。**全部素材可一键重新生成**。
- **素材路径（MIT）**：
  - `assets/whale_sprite.png`（主形象，透明底）
  - `assets/sheets/whale_{idle,blink,happy,sleep,walk,wave}.png`（各动画透明序列图）
  - `assets/frames_magenta/{idle,walk,wave,blink,happy,sleep}_*.png`（洋红底帧，运行时抠色）
  - `codex-package/deepseek-whale-girl/spritesheet.webp`（**1536×1872，192×208 格子、每行 8 帧、9 行动画**）+ `pet.json`
- **判定**：**最适合当"自己的鲸鱼娘"的起点**——MIT、可重画、可改配色，不依赖任何第三方权利人。

### 4.7 `Win-Hao/seek-on-dsh`（MIT，1★）

- **形态**：DSH Web 插件，挂在 `shell.overlay` 全框浮层，鲸鱼浮在右下角；拖拽记忆 `localStorage`。
- **素材**：**14 个自带动画的单个 SVG**（`assets/seek-{idle-chart,idle-coffee,idle-follow,idle-read,working-terminal,working-typing,thinking,spouting,sleeping,notification,error,attention,carrying,yawning}.svg`，107KB–226KB/个），鲸鱼是 DeepSeek logo 像素化成 **40×31 网格**后逐帧动起来；**无 GIF/APNG/脚本**，靠 SVG 内 CSS keyframes。`build.mjs` 把 SVG gzip 后内联进 `lib/client.js`（约 310KB）。
- **许可**：**MIT**；但 README 注明"**鲸鱼形象衍生自 DeepSeek logo**"——商标层面需注意（自用无所谓，商用/上架有风险）。
- **可复用性**：SVG 方案在 TV WebView 里缩放不糊、体积小，**很适合当"备选美术风格"**。

### 4.8 `lhh010/dsh-ui-whale`（BSD-3-Clause，46★）——鲸鱼（不是鲸鱼娘）

- **形态**：DSH Web UI 插件，会话标题栏常驻，眨眼/摆尾/动胸鳍/喷水/冒爱心/睡觉。
- **素材格式很特别**：**不是图片**，是文本像素矩阵——
  - `sprites/whale-frames.json`（25KB，`[{"name":"STANDARD","w":40,"h":25,"rows":["0000...","0/1/2..."]}]`）
  - `sprites/whale-raw.txt`（33KB）
  - `src/client/sprite-data.ts`（27KB，`FRAMES: Record<FrameName, readonly string[]>`，调色板 7 色：深蓝 `#203864`、身体蓝 `#0066FF`、浅蓝 `#B4C7E7`、白 `#F2F2F2`、粉 `#CC3399`、灰 `#808080`）
  - 共 22 帧（STANDARD/BLINK/FIN_1-2/SPOUT_1-6/TAIL_1-4/HEART_1-3/SLEEP_1-5）
- **许可**：**BSD-3-Clause**（`Copyright (c) 2026, lhh010`）。**这是"鲸鱼"，不是"鲸鱼娘"**——GHSYES 把它当成鲸娘 GIF 的出处，但 lhh010 仓库里只有鲸鱼帧数据；真正"鲸娘表情集"在 `dshtui.com/pets/whale-girl-emoji/`。
- **可复用**：40×25 文本矩阵 + 7 色板，**重绘/换色成本极低**，适合当办公室场景里"游来游去的小鲸鱼"道具。

### 4.9 `yanzwzz/dsh-whale-girl-pet`（npm `dsh-whale-girl-pet` 0.3.11，MIT，47★）

- **形态**：DSH Web 插件，蓝发鲸鱼女仆住进 Web 界面；46+ 动画；带余额/天气/喂食、费用 pill、睡眠系统。
- **素材**：仓库 90 个文件，`assets/preview/preview-{idle,work,done}.gif`、`assets/thumb/peek-edge.png`（316×712，AI 生成后软色键处理）；**主精灵内联在 `lib/client.js`，没有独立帧文件**。
- **许可**：README 写 MIT。**但美术多为 AI 生成的整图**，无逐帧授权链说明——自用可以，分发前建议确认。

### 4.10 npm `dsh-pixel-whale-pet`（MIT，`Copyright (c) 2025 YJJ730`）

- **形态**：DSH Desktop **Win32 原生叠加窗口**插件（TypeScript + `koffi` FFI 调 user32/gdi32，`CreateDIBSection` + `UpdateLayeredWindow` 逐帧画），窗口透明置顶、不进任务栏；点一下触发 happy 动画；气泡文字。
- **素材（有独立文件，可复用）**：`assets/pixel-whale.png` = **256×128 精灵图，8×4 格、32px 格**，4 行动画（待机/游泳/睡觉/开心）。
- **注意**：它是**鲸鱼**，不是鲸鱼娘；Windows Only。

---

## 5. 对比总表

| 项目 | 是什么 | 独立 App 还是 DSH 插件 | 技术栈 | 许可 | 可复用资产 | 备注 |
|---|---|---|---|---|---|---|
| [`harishkotra/agent-office`](https://github.com/harishkotra/agent-office) 408★ | 自生长 AI 团队像素办公室（Ollama 驱动） | **独立 Web App** | Phaser 3.80 + React 18 + Colyseus 0.15 + SQLite + Docker | **MIT** | `packages/ui/public/assets/characters/char_0..5.png`、`characters.png`、仓库内 vendored 的 `pixel-agents-repo/**` | Web Only；Voice/Mobile 均在 Roadmap 未做；无 DSH、无鲸鱼娘 |
| [`Thunderunruly/agent-office`](https://github.com/Thunderunruly/agent-office)（npm `dsh-pixel-office`） | DSH 的固定像素办公室大楼（workspace=楼层、session=办公室） | **DSH 插件** | 无构建系统；`client.js` 单文件；Canvas 2D | **MIT** | **零图片**：`src/art-{core,city,building,room}.js`（程序化 Canvas 绘制，16×24 小人 + 家具） | 最贴近"DSH 办公室"；数据层绑 DSH API，搬独立 App 需自写数据源 |
| [`wyx135230/DeepSeek-Office`](https://github.com/wyx135230/DeepSeek-Office) 17★ | 唯一叫 "DeepSeek Office" 的项目：2.5D 办公室（开会/咖啡/放映室） | **DSH Web 插件**（`deepseek-office`） | **Three.js + Phaser**，需 WebGL | **代码 Apache-2.0**；素材混合（LPC = CC BY-SA、Momo = CC0） | 交互设计/架构可参考；3D 模型不便于单搬 | 明确说 mobile 不是目标；无 TV；非像素风 |
| [`pixel-agents-hq/pixel-agents`](https://github.com/pixel-agents-hq/pixel-agents) 10.1k★（原 pablodelucca） | VS Code 插件，把终端里的 AI agent 变成办公室里的小人 | **VS Code 扩展** | React Webview + Canvas 2D + 路径寻路 | **MIT**（角色基于 JIK-A-4 Metro City，需另核上游条款） | `webview-ui/public/assets/`：`characters/char_0..5.png`(112×96)、`floors/floor_0..8.png`(16×16)、`walls/wall_0.png`、`carpets/`、`furniture/*/{png,manifest.json}`、`pets/{gitcat,claudio}/pet.png`、`characters.png`(640×144) | 办公室贴图最全、最"正统"；纯前端可移植 |
| [`thuyqpham/dsh-tv`](https://github.com/thuyqpham/dsh-tv) 0★（2026-11-09） | **Android TV 语音终端 + Whale-chan 动画宠物**，反向控制 TV | **独立 Android TV APK**（+ 可选 DSH 插件 UI） | Java/Leanback + 无障碍服务 + QR 配对 + SenseVoice ONNX + Python 宿主机（8766） | **MIT**（图标除外） | `android/tv-assistant/res/raw/whale_{idle,busy,think,wave,celebrate,wilt}.webp`（6 段透明动画，来自 1tryout MIT） | **唯一现成 TV APK**；无办公室；无长按 OK；需 LAN 宿主机 |
| [`regrevia/pocket-harness`](https://github.com/regrevia/pocket-harness)（npm `dsh-pet-voice`） | 「鲸灵」手机悬浮鲸鱼娘 + 语音唤醒 + 派活 DSH | **DSH 插件 + Android APK + PWA** | Kotlin（零 androidx）、edge-tts、Whisper/SpeechRecognizer、长轮询 | **MIT（代码+像素素材）** | `android/app/src/main/assets/aster/{casual,maid}/pose_*.webp`（>20 姿势，`scripts/build-aster-assets.py` 生成） | 手机竖屏，非 TV；但**语音+APK+鲸鱼娘**三件套现成 |
| [`ccch1mneyyy/dsh-go`](https://github.com/ccch1mneyyy/dsh-go) | DSH 的 Android 客户端（手机跑/遥控电脑），内置 Deepy + 鲸娘 宠物 | **独立 Android APK** | Flutter + Kotlin，Android 8+ | **AGPL-3.0**；**吉祥物素材保留所有权利** | `app/assets/pets/whale-girl/*.png`（22 段横向精灵条，52×49/帧）+ `pack.json` | 用户所说 "dsh go"；**素材不可直接复用** |
| [`GHSYES/dsh-whale-girl-pet`](https://github.com/GHSYES/dsh-whale-girl-pet) 3★ | Electron 透明置顶鲸娘桌宠（Win） | **DSH Desktop 插件 + Electron 独立窗** | ESM 插件 + Electron 44（自动下载） | 代码 MIT；**GIF 声称 BSD-3** | `assets/gifs/01-idle.gif`…`22-thumbs-up.gif` | Windows Only；与 DSH-TUI 的"保留所有权利"声明冲突 |
| [`WenQ-cloud/dsh-cutewhale-h`](https://github.com/WenQ-cloud/dsh-cutewhale-h) 5★ | 住在输入框左侧的像素鲸鱼娘 | **DSH Web 插件** | 单文件 `client.js`（3.6MB，贴图内联） | 代码 MIT；**美术 CC BY-NC-SA 4.0（禁商用）** | 无独立素材文件，需从 client.js 解包 | 授权链：溟月(上善无形)→女仆鲸鱼娘(ZipZipPipe)→像素图(Oo肥鱼O) |
| [`chenthreegold/deepseek-whale-pet`](https://github.com/chenthreegold/deepseek-whale-pet) 5★ | 代码手绘的像素鲸鱼娘（Codex 桌宠包 + Python 桌宠） | **独立桌宠（tkinter）** | Python/tkinter + Pillow | **MIT** | `assets/sheets/whale_*.png`、`whale_sprite.png`、`codex-package/.../spritesheet.webp`（1536×1872 / 192×208×8 列×9 行） | **可完全重生**（`scripts/draw_pet.py`），许可最干净 |
| [`Win-Hao/seek-on-dsh`](https://github.com/Win-Hao/seek-on-dsh) 1★ | 右下角像素小鲸鱼，跟会话状态反应 | **DSH Web 插件** | 单 SVG 内 CSS keyframes，gzip 内联 | **MIT**（形象衍生自 DeepSeek logo） | `assets/seek-*.svg`（14 个，40×31 网格） | 矢量不糊，适合 TV；是"鲸鱼"非"鲸鱼娘" |
| [`lhh010/dsh-ui-whale`](https://github.com/lhh010/dsh-ui-whale) 46★ | 会话标题栏像素鲸鱼伙伴 | **DSH Web 插件** | 文本像素矩阵 + 7 色调色板 | **BSD-3-Clause** | `sprites/whale-frames.json`、`src/client/sprite-data.ts`（40×25×22 帧） | 重绘/换色成本极低 |
| npm [`dsh-pixel-whale-pet`](https://www.npmjs.com/package/dsh-pixel-whale-pet) | Win32 原生叠加窗像素鲸鱼 | **DSH Desktop 插件** | TS + koffi FFI + GDI layered window | **MIT**（YJJ730） | `assets/pixel-whale.png`（256×128，8×4 格，32px） | Windows Only；是鲸鱼不是鲸鱼娘 |
| [`yanzwzz/dsh-whale-girl-pet`](https://github.com/yanzwzz/dsh-whale-girl-pet)（npm `dsh-whale-girl-pet`）47★ | Web 界面蓝发鲸鱼女仆，46+ 动画 + 费用/余额 | **DSH Web 插件** | 单文件 `client.js` | README 写 MIT | `assets/preview/*.gif`、`assets/thumb/peek-edge.png` | 主精灵内联；美术多为 AI 整图 |
| [`leozvc/pixel-office-story`](https://github.com/leozvc/pixel-office-story) 0★ | **Android APK 像素办公室 + DSH 任务编排**（日式经营 + PM 对话 + 语音） | **独立 Android App** | 原生 Canvas + JS，**零图片资源**，WebView 壳 `com.pixelboss.office` | **无 LICENSE**（默认保留所有权利） | `game/` 程序化像素美术、`android/` Gradle 壳、`dsh-plugin/lib/taskboard-*.cjs` | **形态最接近"TV 前的手机版"**；仅作架构参考，代码不可复用 |
| [`bagidea/bagidea-office`](https://github.com/bagidea/bagidea-office) 261★ | 桌面壁纸上的 AI Agent 办公室 | 独立桌面应用 | JS | **MIT** | 办公室生活/委派机制 | 非 DSH、无鲸鱼娘 |

---

## 6. 资产复用判定（关键）

### 6.1 鲸鱼娘：能用 / 不能用

| 素材源 | 文件路径（raw URL 前缀 `https://raw.githubusercontent.com/<repo>/main/`） | 许可 | 义务 | 判定 |
|---|---|---|---|---|
| **DSH Go 鲸娘（就是孩子现在看到的那只）** | `ccch1mneyyy/dsh-go/master/app/assets/pets/whale-girl/{idle,thinking,…,thumbs-up}.png` + `pack.json` | **保留所有权利**（`ASSETS.md`）；`pack.json` 只写"作者授权 dsh-go 使用" | 需 ccch1mneyyy / DSH-TUI 书面授权；再发布必须换素材 | ❌ **不要直接拷** |
| **chenthreegold** | `assets/sheets/whale_{idle,walk,wave,blink,happy,sleep}.png`、`assets/whale_sprite.png`、`codex-package/deepseek-whale-girl/spritesheet.webp` | **MIT** | 保留版权与许可声明 | ✅ **首选**，还可改 `scripts/draw_pet.py` 重画 |
| **regrevia/pocket-harness** | `android/app/src/main/assets/aster/{casual,maid}/pose_{approve,happy,point,pout,shrug,shy,surprise,think,wave}_closed|open.webp` | **MIT（代码+素材）** | 保留 MIT 声明 | ✅ **首选之一**（闭/睁眼双版，方便做眨眼） |
| **1tryout/dsh-whale-pixel-pet** | `dsh-pet/assets/webm/*.webm`（106 段，640×360，VP9-alpha）+ `dsh-pet/assets/preview/*.gif` + `dsh-pet/assets/memes/*.png` | **MIT** | 保留声明；dsh-tv 提示"人物版权仍属原作者" | ✅ 适合 TV 大屏（视频式动画最省事），注意体积（106 段共约 54MB） |
| **Er1c0v0/dsh-whale-pet** | `character/{idle,ready_*,working_*,need_input,blocked,idle_pillow_*}.png` | 仓库 MIT，但 `ASSET_ATTRIBUTION.md` 明确**人物美术 CC BY 4.0** | **必须署名** Er1c0v0 + 标注修改 | ✅ 可商用（CC BY） |
| **lhh010/dsh-ui-whale** | `sprites/whale-frames.json`、`src/client/sprite-data.ts` | **BSD-3-Clause** | 保留版权声明/免责声明；不得用作者名背书 | ✅ **但这是鲸鱼，不是鲸鱼娘** |
| **GHSYES 的 22 张 GIF** | `assets/gifs/0X-*.gif` | 自称 BSD-3（lhh010） | 与 DSH-TUI"保留所有权利"冲突 | ⚠️ 谨慎，建议绕开 |
| **WenQ-cloud** | 内联于 `client.js`（无独立文件） | **CC BY-NC-SA 4.0** | 署名 + 非商业 + 同协议共享 | ⚠️ 仅限私人非商业；且要自己解包 |
| **DSH Go 品牌/图标、Win-Hao 鲸鱼** | — | DeepSeek 商标/衍生 logo | 商标风险 | ⚠️ 自用可，分发/上架需换原创 |

**一句话**：想复刻"孩子在 DSH Go 里看到的那只鲸娘"，**先向 `ccch1mneyyy` / DSH-TUI 要授权**（他明确写了可以谈：改名换素材或授权）；不想求人，就用 **chenthreegold（MIT）或 regrevia（MIT）** 的鲸鱼娘，或让 AI 按你给的参考图重画一套。

### 6.2 办公室贴图：能用 / 不能用

| 素材源 | 文件路径 | 许可 | 义务 / 注意 |
|---|---|---|---|
| **Thunderunruly（强烈推荐）** | `src/art-core.js`（调色板/像素原语/16×24 人物/家具套件）、`src/art-room.js`、`src/art-building.js`、`src/art-city.js` | **MIT** | 需保留 MIT；代码即美术，**无图片依赖、无第三方素材包袱**，直接搬进 Canvas/Phaser/WebView |
| **pixel-agents** | `webview-ui/public/assets/characters/char_0..5.png`（112×96）、`floors/floor_0..8.png`（16×16）、`walls/wall_0.png`、`carpets/carpet_0..2.png`、`furniture/<ITEM>/{<ITEM>.png,manifest.json}`、`pets/{gitcat,claudio}/{pet.png,manifest.json}` | **MIT**（仓库） | 6 个角色基于 **JIK-A-4 "Metro City" 免费包**（`https://jik-a-4.itch.io/metrocity-free-topdown-character-pack`），**上游条款需自行核对/署名**；地板/墙/家具为仓库自带。建议只用地板/墙/家具，角色自己画 |
| **harishkotra** | `packages/ui/public/assets/characters/char_0..5.png`、`characters.png`(160×36)、`agent.png`；`pixel-agents-repo/webview-ui/public/assets/**` | **MIT** | 与 pixel-agents 同谱系；字符同样源自 Metro City |
| **wyx135230/DeepSeek-Office** | `ds-bot/src/client/assets/{office-worker,elevator,cinema}/`、`lpc/`、Ninja Adventure | 代码 Apache-2.0；**LPC = CC BY-SA（通常 3.0/4.0）、Ninja Adventure = CC0、3D 模型作者自备** | 逐项保留署名；CC BY-SA 有传染性；非像素风 |
| **leozvc/pixel-office-story** | `game/js/sprites.js`（程序化） | **无许可** | 只能读思路，不可拷代码 |

---

## 7. 推荐路径与工作量估算

> 前提：孩子只是在电视上看/玩，不上架应用商店；APK 侧载安装（debug 或自签 release 签名即可）。

### 路线 A（推荐，5–10 人日）：在 `dsh-tv` 上加"办公室 + 长按 OK 聊天"

- **底座**：fork `thuyqpham/dsh-tv`（MIT）——Android TV 壳、Leanback、D-pad、QR 配对、TTS/STT、宿主机桥全部现成。
- **要新增**：
  1. **办公室场景层**：新建一个 TV 横屏页面，用 Thunderunruly `src/art-core.js` + `art-room.js` 的函数做 Canvas 2D 绘制（这些是纯函数，几乎零改动能复用）；数据可以先写死一个"鲸鱼娘在办公室"的本地循环（看 TV 场景，不需要真 agent 数据），后续再接 DSH 会话快照。**约 3–5 人日**。
  2. **长按 OK 打开交互/聊天**：TV 端 `KeyEvent.KEYCODE_DPAD_CENTER` 长按（`onKeyLongPress`）→ 弹出对话面板；短按仍是"说话/发送"。**约 1 人日**。
  3. **输入体验**：TV 无键盘，语音是主路径（dsh-tv 已有），文字兜底用手机扫码输入或 D-pad 虚拟键盘。**约 1 人日**。
  4. **素材**：办公室场景用 MIT 程序化美术；鲸鱼娘用 `regrevia`（MIT webp 姿势图）或 `chenthreegold`（MIT 图集）或 `1tryout`（MIT webm 动画，TV 播放 VP9-alpha 需 ExoPlayer/WebView，dsh-tv 已转 WebP 的做法可抄）。**约 1 人日**。
  5. **打包签名 / 遥控器焦点走查 / 开机自启（Leanback launcher）**。**约 1–2 人日**。
- **风险**：dsh-tv 仓库极新（0★，1 天），代码质量与长期维护未知；且**必须有局域网宿主机跑 DSH**，否则 TV 端没"大脑"。

### 路线 B（备选，7–12 人日）：纯 Web 办公室 + Android TV WebView 壳

- 用 Phaser 3 或纯 Canvas 写一个网页版办公室（直接搬 Thunderunruly 美术函数 + pixel-agents 地板/家具），鲸鱼娘用 MIT 动画素材；数据通过 DSH 的 HTTP/WebSocket 接口读（或本地 mock 循环，先给孩子看）。
- 用 `kelai141/dsh-mobile-apk`（MIT，Kotlin WebView 壳）或 `dsh-tv` 的 Leanback 壳包成 APK；`saya-ch/dsh-mobile`（Apache-2.0）可参考移动适配。
- 优点：先在电脑浏览器里迭代，小孩电视端只是"加载一个地址"；改版不用重装 APK。
- 缺点：TV 上 WebView 的 D-pad 焦点管理、性能（1080p 像素缩放）要调；需要局域网可达。

### 路线 C（不推荐，≥3 周）：从零 Flutter / Kotlin 原生

- 参考 `dsh-go`（Flutter）或 `leozvc/pixel-office-story`（原生 WebView + Canvas）的架构，重写办公室 + 鲸鱼娘 + 交互。
- 只有在"要长期维护、要上架、要 TV 本地自治（TV 上直接跑模型）"时才值得；TV 盒子跑 DSH 引擎成本极高（Android 上要 Termux/PRoot，参考 `dsh-mobile-apk` 的 1GB 运行时快照方案）。

### 建议的"最小可用版本（MVP）"定义

1. TV 上装 APK → 全屏 1080p 像素办公室；鲸鱼娘坐在工位/在屋里走动（MIT 素材）。
2. 遥控器方向键移动焦点/视角；**长按 OK** 弹出鲸鱼娘对话气泡面板；短按继续语音对话。
3. 第一版**不接真 LLM**也能给小孩看（本地循环动画 + 预置台词）；第二版再接 DSH（宿主机或设备内）。
4. 语音留到"后面"，但 `dsh-tv`（SenseVoice/Whisper）和 `dsh-pet-voice`（edge-tts/唤醒词）已经给出两条可直接抄的实现。

---

## 8. 参考链接

- DSH Go（Android 客户端）：https://github.com/ccch1mneyyy/dsh-go · 下载页 https://go.dshtui.com/download · 素材声明 https://github.com/ccch1mneyyy/dsh-go/blob/master/ASSETS.md · 鲸娘源页 https://dshtui.com/pets/whale-girl-emoji/
- DSH 包管理器（同名不同物）：https://github.com/coeasy/dsh-go
- Android TV APK（Whale-chan）：https://github.com/thuyqpham/dsh-tv · Release https://github.com/thuyqpham/dsh-tv/releases/tag/v0.1.0
- DSH 像素办公室插件：https://github.com/Thunderunruly/agent-office · npm https://www.npmjs.com/package/dsh-pixel-office · 市场页 https://awesome-dsh-plugin.com/p/Thunderunruly/agent-office/
- 上游灵感：https://github.com/harishkotra/agent-office ｜ https://github.com/pixel-agents-hq/pixel-agents（原 pablodelucca/pixel-agents）
- "DeepSeek Office"（2.5D 插件）：https://github.com/wyx135230/DeepSeek-Office
- 鲸鱼娘素材：https://github.com/chenthreegold/deepseek-whale-pet ｜ https://github.com/regrevia/pocket-harness（npm `dsh-pet-voice`）｜ https://github.com/1tryout/dsh-whale-pixel-pet ｜ https://github.com/Er1c0v0/dsh-whale-pet ｜ https://github.com/lhh010/dsh-ui-whale ｜ https://github.com/Win-Hao/seek-on-dsh ｜ https://github.com/GHSYES/dsh-whale-girl-pet ｜ https://github.com/WenQ-cloud/dsh-cutewhale-h ｜ https://github.com/yanzwzz/dsh-whale-girl-pet ｜ https://www.npmjs.com/package/dsh-pixel-whale-pet
- 手机壳 APK：https://github.com/kelai141/dsh-mobile-apk（MIT）｜ https://github.com/saya-ch/dsh-mobile（Apache-2.0）｜ https://github.com/leozvc/pixel-office-story（无许可，仅参考）
- 插件市场：https://www.dsh.so/ ｜ https://awesome-dsh-plugin.com/
