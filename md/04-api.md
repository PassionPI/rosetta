# 04 · API 与鉴权

## 1. 鉴权（内网，够用即可）

- 密码来自环境变量 `HARNESS_PASSWORD`（明文，公司内网可接受）
- `POST /api/auth/login { password }` → 校验 → `Set-Cookie: harness_session=<hmac 签名 token>`
  - token = HMAC(payload, secret)，payload 含过期时间；secret 首次启动随机生成持久化到 data/
  - 比较用 `crypto.timingSafeEqual`
- Fastify 全局 preHandler：`/api/*` 与 WS upgrade 均校验 cookie；未登录返回 401
- 登出：删除 cookie（可选，单用户场景低优先级）

## 2. REST

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 密码登录 |
| GET | `/api/auth/me` | 校验当前 token |
| GET | `/api/projects` | 项目列表（folder as project；含 repo/worktree/branch 展示元数据，见 07-worktrees） |
| POST | `/api/sessions` | 创建 `{ cwd, model?, thinkingLevel?, name? }` → 立即返回 session 元数据；cwd 先 realpath 规范化（07 不变量 I1） |
| GET | `/api/sessions?cwd=&limit=` | 列表（查 DB 镜像，含 lastRunStatus / usage 汇总） |
| GET | `/api/sessions/:id` | 元数据 + 头部信息 |
| GET | `/api/sessions/:id/entries?fromSeq=` | 树/线性历史（DB 镜像；`activePath=1` 时只取当前分支） |
| GET | `/api/sessions/:id/tree` | 树结构（分支导航用） |
| POST | `/api/sessions/:id/prompt` | `{ text, images?, model?, streamingBehavior? }` → 立即返回 `{ runId }`；结果走 WS |
| POST | `/api/sessions/:id/steer` \| `/followUp` | 流中插话 |
| POST | `/api/sessions/:id/abort` | 中断当前 run |
| POST | `/api/sessions/:id/compact` | `{ customInstructions? }` |
| POST | `/api/sessions/:id/branch` | `{ entryId }` 树内回退（/tree 语义） |
| POST | `/api/sessions/:id/fork` | `{ entryId? }` → 新 session 文件 |
| PATCH | `/api/sessions/:id/name` | `{ name }` |
| GET | `/api/sessions/:id/runs` | run 列表（usage / cost / status） |
| GET | `/api/runs/:runId/steps` | 该 run 的全部工具步骤 |
| GET | `/api/models` | `modelRuntime.getAvailable()` + resolveCliModel 支持 |
| POST | `/api/sessions/:id/model` | `{ model, thinkingLevel }` 运行中切换 |

约定：

- 所有长操作（prompt / compact / fork）**异步化**：路由快速返回，进度与结果经 WS 推送
- 路由层不做业务，薄封装 Registry 方法

## 3. 任务编排（详见 08-tasks.md）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/repos` | 注册 `{ path }` → 检测 main + worktrees，返回池 |
| GET | `/api/repos` | 列表（含各 slot 状态、当前任务） |
| GET | `/api/repos/:id/worktrees` | worktree 池详情 |
| POST | `/api/repos/:id/worktrees` | 新建 `{ name, base? }`（`git worktree add`） |
| DELETE | `/api/repos/:id/worktrees/:wt` | 移除（idle 才允许） |
| GET | `/api/repos/:id/tasks` | 队列 + slot 派发视图 |
| POST | `/api/repos/:id/tasks` | `{ description, dependsOn?: number[] }` |
| POST | `/api/tasks/:id/accept` | `{ commitMessage? }` → git 流水线（§08-7） |
| POST | `/api/tasks/:id/reject` | `{ feedback }` → 反馈回灌 session 返工 |
| POST | `/api/tasks/:id/cancel` \| `/retry` | 终态转换 |

## 4. WebSocket 协议

连接：`GET /ws?session=<sessionId>`（upgrade 时校验 cookie）

### Server → Client

外层信封：

```ts
{
  sessionId: string;
  seq: number;              // 连接内单调递增，客户端检测丢包
  ts: number;
  event: AgentSessionEvent; // pi 原生事件，透传不改造
}
```

补两类自定义信封（非 pi 事件）：

```ts
{ sessionId, type: "run_status", runId, status }   // run 生命周期（含 interrupted 对账）
{ sessionId, type: "backlog", entries: [...] }     // 连接建立时回放 DB 中未推送的增量
{ type: "task_update", task }                      // 任务状态变化（08 编排层，全局广播）
```

### Client → Server（最小集）

```ts
{ type: "subscribe", sessionId }    // 一连接可订阅多会话
{ type: "unsubscribe", sessionId }
{ type: "ping" }
```

### 断线恢复

- 客户端重连后带 `Last-Event-Seq`，server 从 DB/内存缓冲回放缺口（`backlog`）
- `text_delta` 类增量不回放（重连后以 `message_end` 聚合结果为准，前端整条替换）

## 5. 错误处理

- pi 抛错（模型不可用、prompt 校验失败等）→ 路由 4xx/5xx + WS `run_status: error`
- `modelFallbackMessage`（continue 时模型失效回退）→ WS 提示 + DB 记 events
- WS 断开 ≠ run 中断：run 继续在 server 内执行，结果落 DB，重连可见
