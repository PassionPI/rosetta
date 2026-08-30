# 08 · 任务编排（Project / Worktree 池 / Task 队列）

## 1. 需求（原话转述 + 已确认决策）

- 用户注册一个 **project**（= 一个 git repo），harness 用 git 正确找出 **main + 全部
  worktree**，供用户查看
- 用户对 project **add task**：task 是一段自然语言描述
- **调度**：slot 池 = main(slot 1) + worktree(slot 2,3,...)；任务按创建顺序 FIFO；
  派发给**编号最小的空闲 slot**。例：1 完成、2 还有任务、3 空闲 → 派给 1，不派给 3
- task 可声明**依赖**于另一个 task（依赖 = 顺序门：依赖方 done 才解除阻塞）
- task 完成（agent 调 `submit_for_review`）→ **提示用户验收** → 验收通过 →
  **自动 commit + push 当前分支**（不直推 main，worktree 是什么分支就提交什么分支）
  → 释放 slot → 调度下一个任务
- 每个 task 记录 **baseCommit（派发时 HEAD）与 endCommit（验收提交后 HEAD）**，
  任务改动范围 = `git diff <baseCommit>..<endCommit>`

> 与 07 的关系：session 侧 folder as project 不变；08 是**用户主动注册**的 repo 级
> 聚合实体（不是自动归并），不违反 07 的不变量。

## 2. 概念模型

```
Repo (project) ─┬─ worktree: main       slot 1
                ├─ worktree: feature-a  slot 2
                └─ worktree: feature-b  slot 3

Tasks:  #1 ──▶ #2 (depends: #1) ──▶ #3 ──▶ #4
        FIFO 派发到最小空闲 slot；#2 等 #1 done 才就绪
```

**task 的执行体 = 一个普通 pi session（cwd = worktree path）**。复用既有全部能力：
Registry、事件流/WS、steps 审计、重启修复（03）。`sessions.taskId` 关联。

## 3. Worktree 发现与池管理

```bash
git -C <repoRoot> worktree list --porcelain
# worktree /srv/foo            ← main（path == repoRoot）
# branch refs/heads/main
# worktree /srv/foo-ft-a
# branch refs/heads/ft-a
```

- main 识别：`path == repoRoot`；其余为 linked worktree
- slot 顺序：main 固定 slot 1；linked 按注册顺序（可调）
- worktree 状态：`idle | busy（执行中）| unavailable（派发时 dirty / 用户手动占用）| disabled（用户排除）`
- UI 支持新建（`git worktree add <name> [base]`）与移除——并行度 = slot 数

## 4. Task 状态机（转换表）

| from | 事件 | to |
|---|---|---|
| queued | deps 全 done 且有空闲 slot | running（记录 `baseCommit = HEAD`） |
| running | agent 调用 `submit_for_review` 工具 | awaiting_review（工具参数里的摘要预填验收页） |
| running | run 结束但未调用 submit_for_review | **保持 running**（UI 提示「未提交验收」，可一键催促） |
| running | run 报错 / 中止 | failed |
| awaiting_review | accept | finishing（git 流水线） |
| awaiting_review | reject（反馈文本） | running（followUp 回灌 session） |
| finishing | commit + push 成功 | done（记录 `endCommit`，释放 slot） |
| finishing | git 异常 | failed（error 说明；本地 commit 保留，处理后 retry） |
| failed | retry | running |
| 任意 | cancel（确认） | cancelled（**不自动清理工作区**，UI 提示手动处理） |

| 状态 | 占 slot | 说明 |
|---|---|---|
| queued | 否 | 等依赖满足或空闲 slot |
| running | 是 | session 活跃；用户可 steer / 在 SessionView 继续对话 |
| awaiting_review | 是 | 待验收；工作区有未提交改动 |
| finishing | 是 | git 流水线（commit + push 当前分支）执行中 |
| done | 否（释放） | 已提交推送；baseCommit/endCommit 齐全 |
| failed | 是（默认，占住等人工） | error 字段记录原因 |
| cancelled | 否 | 工作区不自动清理 |

调度触发点（事件驱动，非轮询）：task 创建 / done / cancel / worktree 增删 / boot。

## 5. 调度器

```
dispatch():
  slots  = [main, wt...] 按 slotOrder 升序
  ready  = tasks where status=queued AND 所有 deps ∈ {done}，按 seq 升序
  for slot of slots where slot.status == idle:
      if ready 空: break
      task = ready.shift()
      assign(task, slot)   # 建 session、发初始 prompt、记录 baseCommit、status=running
```

- 「1 完成、2 忙、3 空闲 → 派 1」即此循环的自然结果
- **deps 语义（顺序门）**：依赖方 `done`（已验收提交）才解除阻塞；代码集成由用户
  自行管理分支（不自动 merge、不 branch stacking）
- 无依赖的任务不被前序阻塞（#2 等 #1 时，#3 可先派）
- 一个 worktree 同时最多 1 个 task

## 6. 执行（task → pi session）

- task-runner 经 factory 在 worktree path 建 session，写 `sessions.taskId`
- **初始 prompt 模板**：

```
你在 git worktree {path}（分支 {branch}）中独立完成一个开发任务。
任务：{description}
{如有前置依赖：「前置任务均已完成并提交，摘要：{summaries}」}
约束：
- 不要执行 git commit / git push（验收后由系统统一提交推送）
- 完成后调用 submit_for_review 工具提交验收，摘要里说明：做了什么、改了哪些文件、如何验证
```

- **完成信号 = agent 调用 `submit_for_review`**（defineTool 注入的自定义工具，
  参数：`{ summary: string }`）。execute 回调里直接把 task 置为 awaiting_review
- run 结束但未调用 → 保持 running，task_update 附 note（UI「催促」按钮发提醒 prompt）
- branch 策略：**沿用 slot 当前分支**，不创建任务分支；派发时记录 `baseCommit = HEAD`

## 7. 验收与 git 流水线（accept）

UI 预填 commit message（description 首行 + submit_for_review 摘要，可编辑），确认后：

```
1. git -C <wt> add -A
2. git -C <wt> commit -m <msg>                  # 无改动则跳过
3. endCommit = git -C <wt> rev-parse HEAD       # 记录
4. git -C <wt> push origin HEAD                 # 当前分支
5. task=done → 释放 slot → 触发 dispatch
```

- **不直推 main**：当前是什么分支就提交什么分支（分支策略由用户管理）
- **任务改动范围 = `git diff <baseCommit>..<endCommit>`**（验收页展示同一范围）
- push 失败（无远端 / 网络）→ `failed` + error 说明；本地 commit 保留，用户处理后 retry
- 无 origin 时降级为仅本地 commit（UI 警告）

**reject（返工）**：UI 输入反馈 → 作为 followUp prompt 发进 session → `running`
（rejectCount++）。

**cancel**：标记 `cancelled`；**不自动清理工作区**（可能混有用户手动改动），
UI 提示手动处理（git status / reset 由用户决定）。

## 8. 重启安全（衔接 03）

tasks 表为事实源，boot 对账：

| 中断时状态 | 恢复动作 |
|---|---|
| queued | 不变，boot 后参与 dispatch |
| running | session 按 03 修复（悬空 toolCall 等）；task 保持 running + 中断标记，等用户 continue（UI 手动按钮） |
| awaiting_review | 不变 |
| finishing | 幂等重放 git 步骤（已 commit 则跳过；push 已成功则 done） |
| failed / done / cancelled | 不变 |

worktree 池重建：`git worktree list` 与 DB 对照，差异回写。

## 9. 安全边界

- 派发前检查 slot 是否 dirty（用户手动占用）→ `unavailable`，跳过该 slot 并提示
- **不做任何强制清理**（reset --hard / clean 一律不自动执行，只在 UI 提示）
- main 作为 slot 1 是明确需求；提供 repo 级开关 `useMainAsSlot`（默认开）
- 同 repo 的 git 写操作（commit/push）在 git-ops.ts 内**串行加锁**，避免并发写
- agent 被 prompt 约束不 commit/push（暂不做 bash 层 git 硬禁，见 06-todo）
