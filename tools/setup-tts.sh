#!/usr/bin/env bash
# 一次性安装鲸鱼娘语音引擎（edge-tts，微软中文神经语音，免费）
#
# 用法：
#   ./tools/setup-tts.sh                # 装到 ~/.dsh-office-tts/venv
#   DSH_OFFICE_TTS_HOME=/path ./tools/setup-tts.sh
#
# 装完后启动 bridge，页面里的鲸鱼娘就会用「好听的中文语音」说话；
# 没装也能用（bridge 返回 503，网页自动回退到 Android 系统 TTS / 字幕）。
set -euo pipefail

HOME_DIR="${DSH_OFFICE_TTS_HOME:-$HOME/.dsh-office-tts}"
VENV="$HOME_DIR/venv"

echo "== 安装 edge-tts 到 $VENV =="
mkdir -p "$HOME_DIR"
if [ ! -x "$VENV/bin/python3" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet --upgrade edge-tts

echo
echo "== 可用的中文音色（zh-CN）=="
"$VENV/bin/edge-tts" --list-voices 2>/dev/null | grep -E '^zh-CN' || true
echo
echo "默认音色：zh-CN-XiaoyiNeural（活泼少女，适合鲸鱼娘）"
echo "想换：改 bridge/config.json 里的 tts.voice，或 TTS_VOICE=... ./tools/serve.sh"
echo
echo "== 试听 =="
TEXT='小朋友你好呀～我是小鲸鱼，今天办公室里有好多小朋友在忙呢。'
"$VENV/bin/edge-tts" --voice "${TTS_VOICE:-zh-CN-XiaoyiNeural}" --text "$TEXT" \
  --write-media "$HOME_DIR/sample.mp3"
echo "试听文件：$HOME_DIR/sample.mp3"
