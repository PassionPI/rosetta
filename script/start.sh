#!/usr/bin/env bash
# 启动 rossetta server（手动模式；开机自启请用 install-systemd.sh）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 加载环境变量（script/env 不入库）
if [ -f "$ROOT/script/env" ]; then
  set -a; . "$ROOT/script/env"; set +a
fi
PORT="${HARNESS_PORT:-3173}"
PID_FILE="$ROOT/data/harness.pid"
LOG_FILE="$ROOT/data/harness.log"

if [ -z "${HARNESS_PASSWORD:-}" ]; then
  echo "⚠  HARNESS_PASSWORD 未设置（复制 script/env.example → script/env 并填写），所有登录将被拒绝" >&2
fi

# systemd 托管时交给 systemd
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet rossetta 2>/dev/null; then
  echo "rossetta 已由 systemd 托管：systemctl status rossetta"
  exit 0
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "已在运行 (pid $(cat "$PID_FILE"))。重启请先执行 script/stop.sh"
  exit 0
fi
rm -f "$PID_FILE"

if [ ! -f "$ROOT/apps/server/dist/index.js" ]; then
  echo "dist 不存在，先构建…"
  pnpm --filter @rossetta/server build
fi

mkdir -p "$ROOT/data"
nohup node "$ROOT/apps/server/dist/index.js" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "启动中 (pid $(cat "$PID_FILE"), :$PORT)，日志: $LOG_FILE"

for _ in $(seq 1 15); do
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✖ 进程已退出，最近日志："
    tail -20 "$LOG_FILE"
    exit 1
  fi
  # 不用 -f：404/401 也算存活（web 未构建时 / 返回 404）
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then
    echo "✓ http://$(hostname 2>/dev/null || echo localhost):${PORT}/ 已就绪"
    exit 0
  fi
done
echo "⚠  15s 内端口未就绪（可能仍在初始化模型目录），跟踪日志: tail -f $LOG_FILE"
