#!/usr/bin/env bash
# 本机开发：并行起 server（tsx watch）与 web（vite），Ctrl-C 一起退
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f "$ROOT/script/env" ]; then
  set -a; . "$ROOT/script/env"; set +a
fi
if [ -z "${HARNESS_PASSWORD:-}" ]; then
  echo "⚠  HARNESS_PASSWORD 未设置，登录会被拒绝（script/env）" >&2
fi

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

echo "server → http://localhost:${HARNESS_PORT:-3173}   web → http://localhost:9999（--host 已暴露局域网）"
pnpm --filter @rosetta/server dev & pids+=($!)
pnpm --filter @rosetta/web dev & pids+=($!)
wait
