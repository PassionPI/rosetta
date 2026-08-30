#!/usr/bin/env bash
# 优雅停止 rossetta server（SIGTERM → 等待 → SIGKILL 兜底）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/data/harness.pid"

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet rossetta 2>/dev/null; then
  echo "由 systemd 托管，请使用: sudo systemctl stop rossetta"
  exit 0
fi

if [ ! -f "$PID_FILE" ]; then
  echo "未发现 pid 文件（未在运行？）"
  exit 0
fi

PID="$(cat "$PID_FILE")"
echo "SIGTERM → ${PID}（优雅停机，最长 12s）"
kill -TERM "$PID" 2>/dev/null || true
for _ in $(seq 1 24); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "✓ 已停止"
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 0.5
done
echo "超时未退出，SIGKILL"
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
