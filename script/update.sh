#!/usr/bin/env bash
# 拉取依赖 → 构建 → 重启（systemd 或手动模式自动识别）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "── pnpm install ──"
pnpm install

echo "── build ──"
pnpm --filter @rosetta/server build
pnpm --filter @rosetta/web build

echo "── restart ──"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet rosetta 2>/dev/null; then
  sudo systemctl restart rosetta
  sleep 2
  systemctl --no-pager -l status rosetta | head -8
else
  "$ROOT/script/stop.sh" || true
  "$ROOT/script/start.sh"
fi
