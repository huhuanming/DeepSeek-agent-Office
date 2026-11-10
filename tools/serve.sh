#!/usr/bin/env bash
# 启动 DSH Office TV bridge（Mac 端）。Ctrl+C 退出；电视地址在启动日志里。
#
# 用法：
#   tools/serve.sh                 # 默认 8765
#   PORT=8767 tools/serve.sh       # 换端口
#   PET_DIR=/path/to/pet tools/serve.sh
#
# 也可以直接：node bridge/server.mjs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  # nvm 环境里 GUI/脚本启动时 PATH 可能没有 node
  for candidate in \
    "$HOME/.nvm/versions/node/v24.13.0/bin/node" \
    "$HOME/.nvm/versions/node/v22.0.0/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ ! -x "$(command -v "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")" ]; then
  echo "[serve] 找不到 node，请先安装 Node 18+（本机推荐 nvm 的 v24.13.0）" >&2
  exit 1
fi

echo "[serve] 项目根目录：$ROOT"
echo "[serve] node：$("$NODE_BIN" -v) · 静态目录：$ROOT/bridge/web"
exec "$NODE_BIN" bridge/server.mjs "$@"
