# 03 · 生命周期与重启语义

## 1. 重启会发生什么（结论先行）

**会话数据不丢；「正在运行的那次 run」死掉。重启后在 session 里发一条普通 prompt
（如 "continue"）即可接着干——pi 没有任何"恢复中断运行"的机制，`pi -c` 只是选择
加载最近 session 文件，与恢复 run 无关。**

### 会保留（JSONL 逐条落盘）

- 已完成的 user / assistant 消息、已完成的 toolResult
- 树结构、labels、compaction、session 名称

### 会丢失

| 丢失项 | 原因 |
|---|---|
| 正在流式输出的 assistant 消息 | pi 只持久化到达终止 stopReason 的消息；`pending` 永不落盘 |
| steer / followUp 队列 | 纯内存 |
| 正在执行的 bash 子进程 | 随 server 进程死亡 |
| `prompt()` Promise 及其 HTTP 上下文 | 进程没了 |

注意：**工具副作用是真实的**——写了一半的文件就是写了一半。磁盘状态与会话状态可能
偏差，续跑时应让模型先重新检查磁盘实际状态。

## 2. 边界情况：悬空 toolCall

崩溃点落在「assistant 消息已落盘（带 toolCall、stopReason=toolUse）→ toolResult
未落盘」之间时，上下文末尾存在未被回应的工具调用，对 LLM API 是非法上下文。

**Harness 兜底**（恢复 session 时检测并修复）：

```ts
// 伪代码：buildContextEntries() 后检查最后一条 assistant 的 toolCall
const dangling = lastToolCallsWithoutResult(context);
for (const call of dangling) {
  sm.appendMessage({
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text: "[interrupted: server restarted mid-execution]" }],
    isError: true,
    timestamp: Date.now(),
  });
}
```

修复后上下文合法，模型"知道"上次被打断，会自行重查磁盘状态。

> ⚠️ 待验证：pi 自身 reopen 时是否已自动处理悬空 toolCall（对照源码
> `packages/coding-agent/src/core/session-manager.ts`）。若已处理则跳过兜底。

## 3. 优雅停机（覆盖常规重启：部署更新 / 手动重启）

```
SIGTERM / SIGINT
  → 停止接受新请求（fastify.close 前置）
  → 对每个活跃 session：session.abort() → agent.waitForIdle() → session.dispose()
       abort 使流中消息以 stopReason="aborted" 正常落盘，不产生悬空状态
  → WriteQueue 强制 flush → DB 连接关闭
  → 超时兜底：5s 内未完成则强制退出（防 LLM 卡死拖住停机）
```

给 dev server 上的更新脚本用 `kill -TERM <pid>`（而非 -9），基本无伤。

## 4. 启动对账（覆盖崩溃场景：kill -9 / 断电 / OOM）

```
boot
  1. DB open + PRAGMA (WAL)
  2. 对账：runs SET status='interrupted' WHERE status='running'
     sessions.lastRunStatus 同步更新；UI 显示「上次运行被中断」状态条
  3. Backfill / 增量同步 JSONL → DB（见 02-storage §5）
  4. Registry 清空（懒加载，不主动恢复任何 session）
```

## 5. 恢复流程（用户在 UI 打开一个 session 时）

```
GET /api/sessions/:id → DB 命中 → Registry.load(id)
  1. SessionManager.open(filePath)
  2. createAgentSession(...)（模型从 session 恢复，失败则回退默认 + modelFallbackMessage）
  3. EventBridge 重新订阅
  4. 悬空 toolCall 检测 + 修复（§2）
  5. 若 sessions.status = interrupted → UI 提示，等用户输入
```

## 6. Auto-continue（可选，默认关）

- 做成 per-session 或全局开关；开启时：恢复完成且检测到 interrupted 状态 →
  harness 自动注入 prompt：
  `"上一个运行被服务重启打断。请先检查相关文件的当前磁盘状态，然后继续完成任务。"`
- prompt 里明确让它先查磁盘，避免基于过期假设续跑
- 默认关闭：防止重启风暴时连环烧 token
- Recorder 里 runs.trigger = 'auto_continue' 与手动触发区分，便于审计
