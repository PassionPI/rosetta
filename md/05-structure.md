# 05 · 项目结构与搭建顺序

## 1. Monorepo 布局（pnpm workspaces）

```
rossetta/
├─ package.json                  # private, workspaces: ["apps/*", "packages/*"]
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ md/                           # 本文档
├─ data/                         # harness.db（gitignore）
└─ apps/
   ├─ server/
   │  ├─ package.json            # fastify @fastify/websocket better-sqlite3 drizzle-orm
   │  │                          # @earendil-works/pi-coding-agent
   │  └─ src/
   │     ├─ index.ts             # 启动：DB → 对账 → Fastify → WS → 信号处理
   │     ├─ config.ts            # 端口/密码/路径（env）
   │     ├─ auth/
   │     │  └─ cookie.ts         # HMAC token 签发/校验
   │     ├─ agent/
   │     │  ├─ registry.ts       # 懒加载 + LRU + dispose
   │     │  ├─ factory.ts        # createAgentSessionRuntime 封装（模型解析/工具集）
   │     │  └─ repair.ts         # 悬空 toolCall 检测 + 合成 toolResult
   │     ├─ recorder/
   │     │  ├─ event-recorder.ts # 事件 → sessions/entries/runs/steps/events 映射
   │     │  └─ write-queue.ts    # 单写队列 + 批量事务
   │     ├─ sync/
   │     │  └─ backfill.ts       # listAll + JSONL 回填/增量同步
   │     ├─ orchestrator/
   │     │  ├─ repo-service.ts   # repo 注册、worktree 池发现/增删（worktree list --porcelain）
   │     │  ├─ scheduler.ts      # 事件驱动 dispatch（FIFO × 最小空闲 slot）
   │     │  ├─ task-runner.ts    # task ↔ session 绑定、初始 prompt 模板、状态机
   │     │  └─ git-ops.ts        # commit/push/merge/slot 复位，同 repo 串行锁
   │     ├─ ws/
   │     │  └─ hub.ts            # WS 连接管理、订阅扇出、backlog 回放
   │     ├─ routes/
   │     │  ├─ auth.ts
   │     │  ├─ sessions.ts
   │     │  ├─ runs.ts
   │     │  └─ models.ts
   │     └─ db/
   │        ├─ schema.ts         # drizzle schema（02-storage）
   │        ├─ index.ts          # 连接 + PRAGMA
   │        └─ migrations/
   └─ web/
      ├─ package.json            # vite react @tanstack/react-query
      └─ src/
         ├─ main.tsx
         ├─ api/                 # fetch 封装 + 类型（来自 packages/shared）
         ├─ ws/                  # WS 客户端、seq 管理、重连
         ├─ pages/
         │  ├─ Login.tsx
         │  ├─ SessionList.tsx   # 按 cwd 分组，含状态/用量
         │  ├─ SessionView.tsx   # 消息流 + 输入框 + run 面板
         │  ├─ ProjectBoard.tsx  # repo 注册、worktree 池/slot 状态、任务队列
         │  └─ TaskReview.tsx    # 验收：diff + session 记录 + accept/reject
         └─ components/
            ├─ MessageItem.tsx   # 按 entry kind 渲染
            ├─ ToolCallCard.tsx  # arguments/result/patch diff 视图
            └─ Composer.tsx      # 输入框（含 steer/abort/图片）
packages/
└─ shared/
   └─ src/
      ├─ dto.ts                  # REST DTO
      └─ events.ts               # WS 信封类型 + pi 事件类型 re-export
```

## 2. 技术栈清单

| 层 | 选型 |
|---|---|
| Runtime | Node 22+，ESM，tsx（dev）/ tsc（build） |
| Server | Fastify + @fastify/static + @fastify/websocket |
| DB | better-sqlite3 + drizzle-orm + drizzle-kit |
| Agent | @earendil-works/pi-coding-agent（SDK） |
| 前端 | Vite + React + TanStack Query + WebSocket 原生 |
| 代码质量 | biome（或 eslint+prettier，待定） |

## 3. 搭建顺序（每步可独立验证）

1. **monorepo 初始化**：workspace / tsconfig / 脚本（dev、build、db:migrate）
2. **db 包内**：schema + 迁移 + 连接 PRAGMA（可独立跑 schema 推导验证）
3. **agent/factory + registry**：最小链路——创建 session、prompt、事件打印到 stdout
4. **recorder + write-queue**：事件落库；验证 DB 与 JSONL 一致
5. **backfill**：listAll 全量回填已有 pi sessions（先于 UI 可用）
6. **routes + auth + ws hub**：REST/WS 全通
7. **lifecycle**：SIGTERM 优雅停机 + 启动对账 + 悬空修复
8. **web**：脚手架 → SessionList → SessionView（消息流 + Composer）→ ToolCallCard/diff
9. **orchestrator**：repo-service → scheduler → task-runner → git-ops → ProjectBoard/TaskReview
10. **收尾**：静态资源服务（server 托管 web build）、更新脚本（kill -TERM + pnpm i + build + start）

## 4. 前端页面要点

- **SessionList**：按 cwd 分组；行内显示 name、最后活动时间、lastRunStatus、累计 cost
- **SessionView**：
  - 消息流按 entries 的 seq 渲染当前分支（activePath）；树切换后刷新
  - streaming 时增量渲染 `text_delta`，`message_end` 后用聚合结果替换
  - 右侧/下方 run 面板：当前 run 的 steps（工具名、耗时、error）、token/cost 实时累加
- **Composer**：普通输入；streaming 时出现「插话 steer / 排队 followUp / 中止 abort」三选
- **树视图**（后期）：分支导航，调 `/tree` + `/branch`

## 5. 运维脚本（已实现，见 `script/`）

| 脚本 | 用途 |
|---|---|
| `script/env.example` | 环境模板（复制为 `script/env`，含密码，不入库） |
| `script/dev.sh` | 本机开发：server + web 并行 |
| `script/start.sh` / `stop.sh` | 手动启停（nohup + pid 文件 + 优雅停机探测） |
| `script/update.sh` | install → build → 重启（自动识别 systemd/手动） |
| `script/install-systemd.sh` | 开机自启：生成 unit，enable --now，崩溃自动拉起 |

详见 `script/README.md`。
