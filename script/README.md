# script/ — 运维脚本

| 脚本 | 用途 |
|---|---|
| `env.example` | 环境变量模板。复制为 `script/env`（不入库），填 `HARNESS_PASSWORD`，建议 `chmod 600` |
| `dev.sh` | 本机开发：tsx watch server + vite web 并行，Ctrl-C 一起退 |
| `start.sh` | 手动启动（生产）：构建检查 → nohup 后台 → pid 文件 → 端口就绪探测 |
| `stop.sh` | 手动停止：SIGTERM 优雅停机（md/03 §3），12s 超时后 SIGKILL 兜底 |
| `update.sh` | 一条龙：pnpm install → build server+web → 重启（自动识别 systemd/手动模式） |
| `install-systemd.sh` | **开机自启**：生成 `/etc/systemd/system/rosetta.service` 并 `enable --now`（仅 Linux） |

## dev server 首次部署

```bash
# 0) pi 已安装的机器上先登录一次（凭证落在 ~/.pi/agent/auth.json，SDK 复用它）
pi   # 按提示完成 OAuth/API key 登录

# 1) 环境与构建
cp script/env.example script/env && vim script/env   # 填密码
pnpm install && pnpm build

# 2) 安装开机自启（sudo）
script/install-systemd.sh
```

日常更新代码后：`script/update.sh`。

## 两种托管模式

- **systemd**（推荐，dev server）：`install-systemd.sh` 之后由 systemd 托管，
  崩溃自动拉起（`Restart=on-failure`）、开机自启；`start.sh/stop.sh` 检测到
  systemd 托管会拒绝操作并提示对应 systemctl 命令
- **手动**（start.sh/stop.sh）：pid 文件在 `data/harness.pid`，日志追加到
  `data/harness.log`（systemd 模式日志在 journald：`journalctl -u rosetta -f`）

## 注意

- **部署完整仓库目录**（含 `apps/server/src`）：生产 bundle 的迁移目录回退依赖
  `apps/server` 作为 WorkingDirectory 下的 `src/db/migrations`
- node 路径被固化进 unit（nvm 升级 node 后重跑 `install-systemd.sh`）
- `script/env` 含明文密码，已在 `.gitignore`，权限设 600
