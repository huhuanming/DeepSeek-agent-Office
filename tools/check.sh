#!/usr/bin/env bash
# bridge 验收自检（在本机或外置盘项目根都能跑）：
#   tools/check.sh                     # 默认 http://127.0.0.1:8765
#   tools/check.sh http://127.0.0.1:8767
#   tools/check.sh http://192.168.1.23:8765
#
# 依次检查：/health、/api/state（JSON 合法 + 标题/状态）、/api/pet 索引、
# /pet 帧（200 image/webp）、/api/chat（中文 narration）、重复请求耗时。
set -euo pipefail

BASE="${1:-http://127.0.0.1:8765}"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  ❌ %s\n' "$1"; }

echo "== DSH Office TV bridge 自检：$BASE =="

# --- /health --------------------------------------------------------------
echo "[1] GET /health"
HEALTH="$(curl -fsS --max-time 3 "$BASE/health" || true)"
if printf '%s' "$HEALTH" | grep -q '"ok":true'; then
  ok "$HEALTH"
else
  bad "health 不正常：$HEALTH"
fi

# --- /api/state -----------------------------------------------------------
echo "[2] GET /api/state（JSON 合法性 + 真实会话）"
STATE_FILE="$(mktemp -t dsh-offstate.XXXXXX)"
if curl -fsS --max-time 5 "$BASE/api/state" -o "$STATE_FILE"; then
  if node -e '
const fs = require("node:fs")
const model = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (!Array.isArray(model.workspaces)) throw new Error("workspaces 不是数组")
const sessions = model.workspaces.flatMap((w) => w.sessions ?? [])
const running = sessions.filter((s) => s.running || s.status === "working")
console.log(`会话数=${sessions.length} 工作区数=${model.workspaces.length} running=${running.length} pet.mood=${model.pet?.mood}`)
for (const s of sessions.slice(0, 6)) {
  console.log(`  - [${s.status}] ${s.title}${s.running ? ` · ${s.activity} · ${s.elapsedSec}s` : ""}${s.todos?.total ? ` · todo ${s.todos.done}/${s.todos.total}` : ""}`)
}
if (sessions.length === 0) throw new Error("一个会话都没读到")
' "$STATE_FILE"; then
    ok "state JSON 合法"
  else
    bad "state JSON 校验失败"
  fi
  if head -c 200 "$STATE_FILE" | grep -q '"ts"'; then
    ok "state 含 ts/workspaces 字段"
  else
    bad "state 字段缺失"
  fi
else
  bad "GET /api/state 失败"
fi
rm -f "$STATE_FILE"

# --- /api/pet -------------------------------------------------------------
echo "[3] GET /api/pet"
PET_INDEX="$(curl -fsS --max-time 5 "$BASE/api/pet" || true)"
if printf '%s' "$PET_INDEX" | grep -q '"clips"'; then
  CLIP_COUNT="$(printf '%s' "$PET_INDEX" | node -e '
let raw = ""
process.stdin.on("data", (c) => (raw += c))
process.stdin.on("end", () => {
  const index = JSON.parse(raw)
  console.log(`${Object.keys(index.clips).length} 个 clip · baseSize=${index.baseSize} fps=${index.fps}`)
})' 2>/dev/null || echo '?')"
  ok "pet 索引：$CLIP_COUNT"
else
  bad "pet 索引失败"
fi

# --- /pet 帧 --------------------------------------------------------------
echo "[4] HEAD /pet/idle/idle_001.webp"
HEADERS="$(curl -sI --max-time 5 "$BASE/pet/idle/idle_001.webp" || true)"
if printf '%s' "$HEADERS" | head -1 | grep -q '200'; then
  ok "200（$(printf '%s' "$HEADERS" | grep -i '^content-type' | tr -d '\r')）"
else
  bad "pet 帧 404/失败：$(printf '%s' "$HEADERS" | head -1)"
fi

# --- /api/chat ------------------------------------------------------------
echo "[5] POST /api/chat（narration）"
CHAT="$(curl -fsS --max-time 12 -X POST "$BASE/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"question":"他们在忙什么"}' || true)"
if printf '%s' "$CHAT" | grep -q '"reply"'; then
  printf '  reply: %s\n' "$(printf '%s' "$CHAT" | node -e '
let raw = ""
process.stdin.on("data", (c) => (raw += c))
process.stdin.on("end", () => {
  try { const data = JSON.parse(raw); console.log(`${data.source}: ${data.reply}`) } catch { console.log(raw) }
})')"
  ok "chat 200"
else
  bad "chat 失败：$CHAT"
fi

# --- 连续轮询耗时（模拟电视 2 秒轮询） ------------------------------------
echo "[6] 连续 5 次 /api/state 耗时"
SLOW=0
for i in 1 2 3 4 5; do
  START="$(node -e 'console.log(Date.now())')"
  curl -fsS --max-time 3 "$BASE/api/state" -o /dev/null || bad "第 $i 次轮询失败"
  END="$(node -e 'console.log(Date.now())')"
  MS=$((END - START))
  printf '  #%d %dms\n' "$i" "$MS"
  if [ "$MS" -gt 2000 ]; then SLOW=$((SLOW + 1)); fi
done
if [ "$SLOW" -eq 0 ]; then ok "重复请求都在 2 秒内"; else bad "$SLOW 次请求超过 2 秒"; fi

# --- /tv 静态 -------------------------------------------------------------
echo "[7] GET /tv"
TV_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/tv" || true)"
if [ "$TV_CODE" = "200" ]; then
  ok "/tv 200"
elif [ "$TV_CODE" = "404" ]; then
  bad "/tv 404（bridge/web/index.html 还没就绪）"
else
  bad "/tv 状态码 $TV_CODE"
fi

echo
echo "== 结果：通过 $PASS 项，失败 $FAIL 项 =="
[ "$FAIL" -eq 0 ]
