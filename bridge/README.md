# DSH Office TV · Mac 端 bridge

把 DeepSeek Harness 的「办公室」投到电视上：Mac 跑这个零依赖 Node 服务，Android TV APK 里的
WebView 打开 `http://<mac-ip>:8765/tv`。bridge 负责读真实会话状态、供给电视网页、鲸鱼娘逐帧素材、
UDP 发现和鲸鱼娘对话。接口约定见根目录 `CONTRACT.md`（v1，冻结）。

## 文件清单

| 文件 | 职责 |
| --- | --- |
| `bridge/server.mjs` | HTTP 服务（`node:http`，**零 npm 依赖**）：路由、静态文件、请求日志、UDP 8766 发现、优雅退出 |
| `bridge/state.mjs` | 读 `~/.dsh/storages/session_projcache/sessions/*.json` → CONTRACT 第 3 节的 OfficeModel；1 秒扫描缓存 + 单文件变更才重算 |
| `bridge/chat.mjs` | 鲸鱼娘对话：无 key 实时 narration；有 `DEEPSEEK_API_KEY` 走 api.deepseek.com，失败降级 |
| `bridge/assets.mjs` | 鲸鱼娘帧索引 + `/pet/<clip>/<frame>` 流式 webp，防目录穿越、长缓存 |
| `bridge/config.json` | 端口 / 状态目录 / 素材目录 / API key 环境变量名 / 暴露的 clip / LLM 参数 |
| `bridge/web/` | 电视网页（**web-scene-builder 维护**，bridge 只做静态服务，不修改这里） |
| `tools/serve.sh` | 启动 bridge 并打印电视地址 |
| `tools/install-apk.sh` | `adb install -r` APK，可选 `--url` 指定 bridge 地址启动 |
| `tools/check.sh` | bridge 验收自检（health / state / pet / chat / 轮询耗时 / tv） |

## 快速开始

```bash
# 1) 启动（默认 0.0.0.0:8765；Ctrl+C 优雅退出）
node bridge/server.mjs
# 或者
tools/serve.sh

# 2) 换端口 / 换素材目录（环境变量覆盖 config.json）
PORT=8767 tools/serve.sh
PET_DIR="$HOME/.dsh/profiles/desktop/node_modules/dsh-dafeiyu/assets/pet" node bridge/server.mjs

# 3) 自检
tools/check.sh                                   # 默认 http://127.0.0.1:8765
tools/check.sh http://192.168.1.23:8765
```

启动日志会打印**所有网卡**的电视地址、状态文件数、petDir 是否可用、当前是 narration 还是 LLM 模式：

```
┌──────────────────────────────────────────────┐
│  dsh-office-tv  bridge v0.1.0  ·  Node v24.13.0  │
└──────────────────────────────────────────────┘
HTTP 监听        http://0.0.0.0:8765  （PID 12345）
电视地址        http://192.168.10.251:8765/tv
                http://198.18.0.1:8765/tv
状态目录        /Users/huanming/.dsh/storages/session_projcache/sessions
状态文件数      91 个（解析成功 91 个）
素材目录        /Users/huanming/.dsh/profiles/desktop/node_modules/dsh-dafeiyu/assets/pet
素材状态        可用 ✓
电视网页目录    /…/deepseek-office-tv/bridge/web
鲸鱼娘对话      narration 模式（未配置 DEEPSEEK_API_KEY）
UDP 发现        8766（收到 "DSH_OFFICE_TV?" 回 "DSH_OFFICE_TV!http://<内网IP>:8765/tv"）
静态文件        /…/deepseek-office-tv/bridge/web → GET /tv
```

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{"ok":true,"name":"dsh-office-tv","version":"0.1.0"}` |
| GET | `/api/state` | OfficeModel，`Cache-Control: no-store`，电视每 2 秒轮询 |
| POST | `/api/chat` | `{"question":"…","sessionId":"可选"}` → `{"reply","speak","source":"llm|narration"}` |
| GET | `/api/pet` | 鲸鱼娘帧索引（13 个 clip、baseSize 412、fps 24） |
| GET/HEAD | `/pet/<clip>/<frame>.webp` | 逐帧 webp，`Cache-Control: public, max-age=86400` |
| GET | `/` | 302 → `/tv` |
| GET | `/tv`、`/app.js`、`/style.css` … | `bridge/web/` 静态文件；找不到时返回中文友好提示（不是白屏） |

所有响应 UTF-8；动态接口 `no-store`（静态资源和 `/pet` 除外）。JSON 解析失败、坏 session 文件、
单个请求异常都不会让进程退出。

### 状态推导规则（重要）

`~/.dsh/storages/session_projcache/sessions/<id>.json` 的字段映射：

- **正在跑**：`record.rows.turnBoundary.val.openTurnStartSeq != null`。
  ⚠️ **不能**用 `sessionStats.openStep`：它在步骤间隙经常是 `null`（实测 2 秒轮询会误判成“刚结束”）。
- **step**：`sessionStats.openStep.step`（步骤中）或 `sessionStats.steps`（已完成步数）。
  `turnBoundary.lastStepStartSeq` 是**事件序号**不是步数，不用它当 step。
- **刚结束（success）**：`openTurnStartSeq == null && lastStepBoundary.kind == "end"`，
  且最后一次“看到在跑”的时刻在 60 秒内（bridge 内存里跟踪 running → 结束的转换，重启后用文件 mtime 兜底）。
- **等待（waiting）**：`rows.userQuestions.val.questions.active` 非空（如 `ask_user_question`）。
  注：approval 事件在本地缓存里没有独立字段，这里以“等用户回答”作为 waiting 信号。
- **error**：尽力而为（`goal.failure` / 非空 `llmRetry` / boundary kind=error），当前数据源基本不会触发。
- **elapsedSec**：本轮用户 prompt 时间（`sessionListMetadata.lastPromptAt`）→ 当前 step `startTime` → 当前时间，
  最多回看 6 小时，跨 bridge 重启也基本准确。
- **lastActivityAt**：跑着的会话 = 现在；否则取 `timeContext.lastMessageTime` / `lastPromptAt` / 文件 mtime 的最大值。
- **子会话**：`subagentCatalog.head.values[].childId` 与 `agentTeam` 成员/任务 owner 的 session 不单独占工位，
  合并进父会话的 `team[]`（child 在跑 → `state: "running"`）。
- **过滤**：只保留最近 24 小时活跃的会话；每个工作区最多 6 个工位；全局最多 24 个，按 `lastActivityAt` 倒序。
- **pet.mood**：任一 waiting → `waiting`；有 running → 该 step 尚无 token 时 `thinking`、否则 `working`；
  刚结束 6 秒内播一次 `success`；平时 `idle`，并每 25~40 秒随机播 2.6~4.2 秒 `idle_yawn` / `idle_stretch`。

### /api/state 实际输出样例（2026-11-10 02:15 本机真实会话）

```json
{
  "ts": 1794248093211,
  "pet": { "mood": "thinking", "since": 1794248093211 },
  "stats": { "sessions": 12, "running": 1, "teammates": 3 },
  "workspaces": [
    {
      "id": "default-workspace",
      "name": "default-workspace",
      "cwd": "/Users/huhuanming/Documents/deepseek-harness/default-workspace",
      "sessions": [
        {
          "id": "session-ce6d8fbd-bff2-4b8e-8de4-9da342859596",
          "title": "参考 agent-office 做 DeepSeek Office",
          "running": true,
          "status": "working",
          "elapsedSec": 442,
          "step": 57,
          "turns": 1,
          "activity": "正在调用工具 · 第 57 步",
          "lastActivityAt": 1794248093211,
          "todos": { "done": 0, "total": 0 },
          "team": [
            { "name": "ecosystem-scout", "role": "teammate", "state": "idle" },
            { "name": "bridge-builder", "role": "teammate", "state": "running" },
            { "name": "web-scene-builder", "role": "teammate", "state": "running" }
          ]
        }
      ]
    }
  ]
}
```

### /api/chat narration 实际输出（无 API key）

```bash
curl -s -X POST localhost:8765/api/chat -d '{"question":"他们在忙什么？"}'
```

```json
{"reply":"小朋友你好呀～办公室里有 1 位小伙伴在忙哦。「参考 agent-office 做 DeepSeek Office」已经忙了 8 分钟啦。","speak":"…","source":"narration"}
```

```bash
curl -s -X POST localhost:8765/api/chat -d '{"question":"谁最努力？"}'
```

```json
{"reply":"现在最努力的是「参考 agent-office 做 DeepSeek Office」！已经忙了 8 分钟啦。旁边还有 bridge-builder、web-scene-builder 在帮忙呢。","source":"narration"}
```

```bash
curl -s -X POST localhost:8765/api/chat -d '{"question":"讲个办公室小故事"}'
```

```json
{"reply":"今天办公室可热闹啦～「参考 agent-office 做 DeepSeek Office」正在认真干活，键盘敲得噼里啪啦的。「QuickNode IPFS 图片无法打开」在旁边打盹，偷偷流了一点口水。我就在旁边看着大家，顺便陪你看电视～","source":"narration"}
```

`source` 规则：配置了 `DEEPSEEK_API_KEY` 时先调 `https://api.deepseek.com/chat/completions`
（system prompt 注入状态摘要，要求中文短句、≤120 字、无 Markdown、不得编造），失败/超时/空回复一律
降级为 narration；`question` 为空、JSON 坏掉也照样 200 + 可爱提示。

## 自测记录（真实输出摘要，2026-11-10 02:13–02:21，本机 Node v24.13.0）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| health | `curl -s localhost:8767/health` | `{"ok":true,"name":"dsh-office-tv","version":"0.1.0"}` |
| state | `curl -s localhost:8767/api/state \| python3 -m json.tool` | JSON 合法；12 个顶层会话 / 2 个工作区 / `running=1`；标题真实 |
| 子会话剔除 | 对比 projcache 里全部 childId | 顶层 12 个 id 中属于子会话的：0 个 |
| 排序 | 脚本校验 | 每个工作区内 `lastActivityAt` 严格倒序 ✓ |
| pet 索引 | `curl -s localhost:8767/api/pet` | `baseSize 412 fps 24 clips 13`（idle…tail） |
| pet 帧 | `curl -sI localhost:8767/pet/idle/idle_001.webp` | `200 image/webp`，`Content-Length 15078`，`Cache-Control: public, max-age=86400` |
| chat | `curl -s -X POST …/api/chat -d '{"question":"谁最努力？"}'` | `200`，中文 narration，提到真实标题与队友 |
| chat 容错 | 空 body / `'{bad json'` / GET | 200 可爱提示 / 200 可爱提示 / 405 |
| LLM 降级 | `DEEPSEEK_API_KEY=sk-fake…` 起服务再聊天 | API 401 后用 narration 返回 200（187ms），日志有降级记录 |
| 2 秒轮询 | 连续 5 次 `/api/state` | 33–38ms，均 < 2 秒 |
| 60 秒稳定性 | 每 2 秒轮询共 30 次 | 失败 0 次，最慢 45ms，无未捕获异常 |
| 优雅退出 | `kill -TERM` | 打印“正在优雅退出”→ HTTP 已关闭；TCP 8776 / UDP 8777 均释放，进程退出 |
| 坏状态文件 | 混入非法 JSON / null / 二进制 / 缺字段文件 | `/api/state` 仍 200，坏文件跳过并 warn，不崩 |
| 目录穿越 | `/pet/../package.json`、`%2e%2e`、`%00` 等 | 全部 404 |
| 404 | `curl localhost:8767/nope` | 404 + 中文友好提示 |
| UDP 发现 | 向 8768 发 `DSH_OFFICE_TV?` | 收到 `DSH_OFFICE_TV!http://192.168.10.251:8767/tv` |
| 状态机模拟 | 改临时 projcache：turn 关闭 → 等确认 | end→`success`+pet success；active question→`waiting`+activity「在等你确认 · 小朋友，要不要继续看？」 |

## 与电视网页 / APK 的关系

- 网页只需要同源请求：`GET /api/state`（2 秒）、`GET /api/pet`、`GET /pet/...`、`POST /api/chat`；
  端口用相对路径，不要写死。
- APK 通过 UDP 8766 发现 bridge；本服务收到 `DSH_OFFICE_TV?` 即回当前内网地址。
- `bridge/web/` 缺文件时 `GET /tv` 返回 404 + 中文提示（不会白屏、不会崩），web 页面放进去后自动生效。

## 已知限制 / 后续

- **approval 等待没有可靠字段**：本地 projcache 不暴露“待审批”状态，`waiting` 目前以“等用户回答的
  `userQuestions.questions.active`”为准；如果后续 DSH 暴露 pending approval 字段，在 `state.mjs` 的
  `activeQuestions` 旁加一个判断即可。
- **error 尽力而为**：数据源没有稳定 error 字段，正常永远不会返回 `error`。
- **每工作区 6 个工位**是电视页面容量假设（`config.json` 的 `maxSessionsPerWorkspace` 可改）。
- **素材许可**：鲸鱼娘帧来自 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)（MIT），
  上游 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT），保留版权声明即可。
