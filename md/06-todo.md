# 06 · 待补充 / 待验证

> 搭骨架前把这里过一遍，逐项补齐或标记「暂缓」。

## 待验证（对照 pi 源码，装包后确认）

- [ ] **悬空 toolCall 的原生处理**：pi reopen session 时是否自动给未回应的 toolCall
      补合成 toolResult？源码位置 `packages/coding-agent/src/core/session-manager.ts` /
      上下文构建逻辑。决定 `agent/repair.ts` 是否需要自建。
- [ ] **events 的完整 payload 形状**：`tool_execution_start/end`、`turn_end`、
      `agent_end` 事件的字段名（toolCallId 的字段名、durationMs 是否自带还是自己计时）。
      装包后看 `.d.ts` 类型定义，落到 recorder 映射表。
- [ ] **`SessionManager.listAll()` 返回结构**：需要哪些字段做 backfill 对账（mtime？
      还是只能 stat 文件）。
- [ ] **多 cwd 的 ModelRuntime 共享**：一个全局 `ModelRuntime` 实例够不够
      （预期够，凭证全局唯一）；`getAvailable()` 的缓存/刷新时机。
- [ ] **`session_info`（name）变更事件**：改名（PATCH name → pi 侧 appendSessionInfo）
      是否产生可订阅事件，还是 recorder 直接写 DB + 读回。
- [ ] **worktree 下 pi 的发现边界**：`.pi/`、AGENTS.md 向上查找是否止于 worktree
      toplevel（`rev-parse --show-toplevel` 预期返回 worktree 自身；实测确认）。
- [ ] **pi 对 symlink cwd 的处理**：传 symlink 路径时 session 目录用哪个字符串
      （我们入口已 realpath，此条只影响绕过 harness 直连 pi 的场景）。
- [ ] **`SessionManager.list(cwd)` 匹配规则**：是否精确字符串匹配 cwd（预期是），
      影响 worktree 会话列表是否天然隔离。

## 待补充（产品/交互细节，用户补充）

- [x] 工具集默认值：read/bash/edit/write 够用，还是加 grep/find/ls（只读排查场景建议加）加
- [x] 模型默认值与可选范围: 用户配置的所有的 pi agent
- [ ] 空闲 dispose 的超时时间（建议 30min？）与 dispose 前是否需要落什么状态
- [x] UI 是否需要「全部会话跨 cwd 搜索」project-wide 视图
- [x] auto-continue 开关的粒度： 仅 UI 手动按钮
- [ ] 明文密码之外是否要加内网 IP 白名单（低优先级）
- [x] 日志方案：暂时不入库（events 表已覆盖大部分审计诉求）

## 待补充（08 任务编排）

- [x] **merge 直推 main 是否可行**：不要直推 main, 当前是什么分支就用什么分支
- [x] **task 完成信号**：要求 agent 调
      `submit_for_review` 自定义工具（更明确，防半途停止被误判完成）
- [x] **deps 阻塞时后序无依赖任务是否可越过**（当前设计：可以；严格串行则加 per-repo 开关）
- [x] **failed 任务的 slot 策略**：占住等人工（当前设计）
- [x] **commit message 模板**：就是普通 commit, 描述清楚修改 就行
- [x] **并行任务同文件冲突预期**：merge 冲突时是提示人工解决
- [x] **task session 的工具白名单**：是否禁 bash 里的 git 命令; 暂不禁用
- [x] **task 级模型/思考档配置**：与手动会话一致
- [ ] worktree 数量上限 / 磁盘水位提醒（worktree 多了占空间）

## 设计上留的口子（暂不实现，先记着）

- auto-continue（03-lifecycle §6）：机制位已留（runs.trigger）
- Postgres 迁移：DAO 走 drizzle，schema 不用 SQLite 特有类型（json 用 text 存）
- 多用户：鉴权层是单密码，升级点集中在 auth/cookie.ts
- RPC 子进程隔离模式：若未来要并行跑大量会话或做沙箱，SDK in-process 可换 runRpcMode
- 自定义工具（defineTool）：harness 侧第一个候选是 `web_search` 或「打开文件预览」类
