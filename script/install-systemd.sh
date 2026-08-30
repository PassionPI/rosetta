#!/usr/bin/env bash
# 安装 systemd 服务（Linux dev server 开机自启）。
# 生成 /etc/systemd/system/rossetta.service 并 enable --now。
# 前置：1) 已编辑 script/env（HARNESS_PASSWORD）2) 已完成 pnpm install && pnpm build
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="rossetta"

# ── 前置检查 ──
command -v systemctl >/dev/null 2>&1 || { echo "✖ 当前系统无 systemd（macOS 本机开发请用 script/dev.sh）"; exit 1; }
[ -f "$ROOT/script/env" ] || { echo "✖ 缺少 $ROOT/script/env（先 cp script/env.example script/env 并填写密码）"; exit 1; }
[ -f "$ROOT/apps/server/dist/index.js" ] || { echo "✖ 未构建，先执行: pnpm install && pnpm build"; exit 1; }
NODE_BIN="$(command -v node)" || { echo "✖ 找不到 node"; exit 1; }
NODE_BIN="$(realpath "$NODE_BIN")"

case "$ROOT" in
  *\ * ) echo "✖ 仓库路径含空格，systemd unit 会出问题: $ROOT"; exit 1 ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  RUN_USER="${SUDO_USER:-root}"
else
  RUN_USER="$(id -un)"
fi
RUN_GROUP="$(id -gn "$RUN_USER")"

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
echo "── 生成 unit（node: $NODE_BIN, user: $RUN_USER, 工作目录: $ROOT/apps/server）──"

sudo tee "$UNIT" >/dev/null <<EOF
# 由 rossetta/script/install-systemd.sh 生成，可重跑覆盖
[Unit]
Description=rossetta harness (pi agent web harness)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT/apps/server
EnvironmentFile=-$ROOT/script/env
ExecStart=$NODE_BIN $ROOT/apps/server/dist/index.js
# SIGTERM 触发 server 内优雅停机（md/03 §3）；15s 后 systemd 强杀
KillSignal=SIGTERM
TimeoutStopSec=15
Restart=on-failure
RestartSec=3
# 日志进 journald: journalctl -u rossetta -f

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sleep 2
echo "── 状态 ──"
systemctl --no-pager -l status "$SERVICE_NAME" | head -10 || true
echo ""
echo "✓ 已安装并设为开机自启。常用命令："
echo "   systemctl status rossetta      # 状态"
echo "   sudo systemctl restart rossetta"
echo "   journalctl -u rossetta -f      # 跟日志"
echo "   script/update.sh               # 依赖+构建+重启 一条龙"
echo ""
echo "注意：node 路径已固化为 ${NODE_BIN}（nvm 升级 node 后需重跑本脚本）"
