# Rossetta — 基于 pi agent 的 Web Harness

> 目标：在 cloudedDevServer（内网 10.x）上跑一个 TS server，提供 Web UI + pi agent 调用，
> 用于远程开发该机器上的项目。pi 原生能力优先，SQLite 做查询/审计扩展。

## 文档索引

| 文件 | 内容 |
|---|---|
| [01-architecture.md](01-architecture.md) | 总体架构、进程模型、核心设计决策、pi SDK 备忘 |
| [02-storage.md](02-storage.md) | 双存储策略、SQLite schema、事件→表的映射、写入策略、回填对账 |
| [03-lifecycle.md](03-lifecycle.md) | 重启语义、优雅停机、启动对账、悬空 toolCall 修复 |
| [04-api.md](04-api.md) | 鉴权、REST 端点、WS 协议 |
| [05-structure.md](05-structure.md) | 目录结构、技术栈、搭建顺序、前端页面规划 |
| [06-todo.md](06-todo.md) | 待补充细节 / 待验证事项（搭建骨架前逐项过一遍） |
| [07-worktrees.md](07-worktrees.md) | git worktree 支持：folder as project、不变量、元数据检测、UI 分组 |
| [08-tasks.md](08-tasks.md) | 任务编排：repo/worktree 池、FIFO × 最小空闲 slot 调度、依赖、验收 git 流水线 |

## 已锁定的决策

| 项 | 结论 | 状态 |
|---|---|---|
| 部署形态 | 单进程跑在 cloudedDevServer（10.x 内网），浏览器本地访问，单用户 | ✅ |
| pi 集成方式 | SDK in-process（`@earendil-works/pi-coding-agent`），非 RPC 子进程 | ✅ |
| 存储 | pi JSONL（`~/.pi/agent/sessions/`）为事实源；SQLite 只做镜像/查询/审计 | ✅ |
| pi 环境 | 完全遵循 dev server 上的 `~/.pi/agent`（auth.json / settings / sessions 全默认） | ✅ |
| 数据库 | SQLite（WAL + better-sqlite3 + Drizzle），DAO 层隔离，留 Postgres 迁移路径 | ✅ |
| 鉴权 | 单明文密码（env），签名 cookie，HTTP + WS 校验 | ✅ |
| 前端 | Vite + React + TanStack Query，WS 实时流 | ✅ |
| 会话加载 | 懒加载：UI 打开 session 时才恢复进 Registry，空闲 dispose | ✅ |
| 中断恢复 | 手动 continue（默认），auto-continue 做成可选开关 | ✅ |
| 项目身份 | folder as project：`realpath(cwd)` 为唯一键，git 元数据仅展示（07） | ✅ |
| 任务编排 | repo 注册 + worktree 池；任务 FIFO 派最小空闲 slot；验收后自动 commit/push/merge（08） | ✅ |

## 环境事实

- pi session 文件：`~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`
  （`<path>` 为 cwd，`/` 替换为 `-`）
- SDK 版本基线：以 npm 上 `@earendil-works/pi-coding-agent` latest 为准（文档对齐 pi.dev/docs/latest）
