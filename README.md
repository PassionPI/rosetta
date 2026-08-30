# rosetta

基于 [pi agent](https://pi.dev) 的 Web harness。设计文档见 [md/](md/README.md)。

## 结构

```
apps/server   Fastify + pi SDK（in-process）+ SQLite（better-sqlite3 + drizzle）
apps/web      Vite + React + TanStack Query
packages/shared  前后端共享 DTO / WS 类型
```

## 开发

```bash
pnpm install
cp .env.example .env         # 改 HARNESS_PASSWORD

pnpm dev:server              # http://localhost:3173
pnpm dev:web                 # http://localhost:5173（代理 /api /ws 到 server）
```

pi 凭证复用运行机器上的 `~/.pi/agent/auth.json`（在目标 dev server 上 `pi` 登录一次）。

## 生产（目标 dev server）

```bash
pi                      # 首次：登录一次（凭证落 ~/.pi/agent/auth.json，SDK 复用）
cp script/env.example script/env && vim script/env
pnpm install && pnpm build
script/install-systemd.sh   # 开机自启 + 崩溃自动拉起（详见 script/README.md）
```

日常更新：`script/update.sh`。手动启停：`script/start.sh` / `script/stop.sh`。
