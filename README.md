# DSH Office TV

把 DeepSeek Harness 的「办公室」搬到电视上给小朋友看：像素/cozy 办公室 + 鲸鱼娘，长按遥控 OK 就能和她互动。

> 个人/家庭自用原型，**非 DeepSeek 官方产品**。

## 30 秒跑起来

```bash
# 1. Mac 上启动服务（零依赖，需要 Node 22+）
./tools/serve.sh
#    会打印：电视地址  http://192.168.x.x:8765/tv

# 2. 浏览器先预览（不用电视也能看）
open http://localhost:8765/tv

# 3. 装到电视（小米盒子5：开发者选项里打开 ADB 调试）
adb connect <盒子IP>:5555
adb install -r dist/app-debug.apk
```

APK 首次启动会自动 UDP 发现 Mac；发现不到就手动指定：

```bash
adb shell am start -n dev.dsh.office.tv/.MainActivity --es url http://<Mac的IP>:8765/tv
```

可选：

```bash
# 好听的中文语音（edge-tts 神经语音，装一次即可；不装就回退系统 TTS + 字幕）
./tools/setup-tts.sh
# 换音色：改 bridge/config.json 的 tts.voice，或 TTS_VOICE=zh-CN-XiaoxiaoNeural ./tools/serve.sh

# 真实模型对话（不设也能用，纯本地解说）
export DEEPSEEK_API_KEY=sk-...
```

语音试听样本在 `assets/voice-samples/`（Xiaoyi / Xiaoxiao / Yunxia / 东北话）。

## 交互

| 操作 | 效果 |
|---|---|
| 短按 OK | 戳一下鲸鱼娘（摸头/摆尾 + 台词） |
| **长按 OK（600ms）** | 打开「和鲸鱼娘聊聊」：他们在忙什么 / 谁最努力 / 讲个办公室小故事 |
| 方向键 | 在工位间移动观察光标，OK 让她介绍这个工位 |
| BACK | 关面板；再按提示是否退出（不会直接退到桌面） |
| 面板第 5 项「🎤 试一下语音」 | 验证遥控器麦克风：弹出系统识别界面，能返回文字就说明可用；不能则走手机/USB 麦 |
| 说话 | 鲸鱼娘用 edge-tts 中文神经语音（默认活泼少女），后台 `/api/tts` 生成并缓存；没装/断网自动回退系统 TTS + 字幕 |

## 目录

```
bridge/     Mac 端 Node 服务：读 DSH 投影缓存 → /api/state、/api/chat、鲸鱼娘素材、电视页面
tv-app/     Android TV APK（Java + WebView 壳，Gradle）
tools/      serve.sh / install-apk.sh / check.sh
assets/     banner、图标、截图
dist/       app-debug.apk
research/   生态调研、Android TV 调研、dsh-tv 拆解
PLAN.md     完整方案（含"有没有现成的"、语音路线、验证记录）
CONTRACT.md 前后端接口契约
```

## 依赖与素材授权

- 运行环境：Node 22+（Mac）、Android 8+（电视）。
- 鲸鱼娘动画来自 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT），上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）；本项目直接读取本机已安装的插件素材，不复制进仓库。
- 其余美术均为程序化 Canvas 绘制，无外部资源、无网络字体。
- 灵感：[harishkotra/agent-office](https://github.com/harishkotra/agent-office)、[Thunderunruly/agent-office](https://github.com/Thunderunruly/agent-office)、[thuyqpham/dsh-tv](https://github.com/thuyqpham/dsh-tv)（借鉴宿主机 ASR 思路）。
