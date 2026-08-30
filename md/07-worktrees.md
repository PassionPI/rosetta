# 07 · Git Worktree 支持（folder as project）

## 1. 需求

一个 git 仓库通过 `git worktree` 挂多个工作目录并行开发。harness 打开任意一个
worktree 时必须把它识别为**独立项目**：

- 独立的会话列表、独立的 session 存储
- UI 能看出它属于哪个 repo（展示元数据），但**绝不能按 git 共享信息归并项目**

反面案例（禁止）：通过 `git rev-parse --git-common-dir` 或解析 worktree 里 `.git`
文件的内容（`gitdir: <main>/.git/worktrees/<name>`）向上追溯到主仓，把所有
worktree 归并成一个项目——这样每个 worktree 就无法区分了。

## 2. 心智模型与不变量

**Project identity = realpath(folder)。git 信息只是展示装饰。**

harness 代码必须遵守的不变量：

| # | 规则 |
|---|---|
| I1 | 项目唯一键 = `fs.realpath(cwd)`。创建 session、注册 project、backfill 入库前一律 realpath |
| I2 | 禁止用 git common dir / 解析 `.git` 文件内容来确定项目身份或做归并 |
| I3 | 不做「向上找 git root 当项目」。git toplevel 在 worktree 内就是 worktree 本身；向上穿越只会到主仓，正是要避免的行为 |
| I4 | 展示层可以按 repoRoot 分组、显示 worktree/branch badge；数据层每个 path 独立一行 |

realpath 的必要性：symlink 指向 worktree 时 `/a/link` 与 `/a/real` 会被当成两个项目，
在入口统一规范化避免身份分裂。

## 3. pi 侧现状（好消息：天然 folder as project）

- **session 存储**：目录名按 cwd 字符串编码（`~/.pi/agent/sessions/--<path>--/`），
  worktree 的 cwd 不同 → session 目录天然隔离，pi 不追溯 git root
- **资源发现**：worktree 内 `git rev-parse --show-toplevel` 返回 worktree 自身路径，
  因此 DefaultResourceLoader 的发现（`.pi/`、AGENTS.md 向上走到 repo root）止于
  worktree 边界，不会串到主仓

### 注意（git 本质，非 harness bug）

AGENTS.md / skills / `.pi/` 目录若只存在于主仓工作区且**未提交**，worktree 内看不到
（worktree 只包含被跟踪文件的 checkout）。缓解方式：

1. 把共享的 AGENTS.md / `.pi/` 提交进仓库（推荐）
2. 全局层放 `~/.pi/agent/`（全局 AGENTS.md、全局 skills/extensions）
3. 以后需要时用 `agentsFilesOverride` 注入共享内容

## 4. 元数据检测（仅展示用，不影响身份）

```bash
top     = git -C <path> rev-parse --show-toplevel
common  = git -C <path> rev-parse --path-format=absolute --git-common-dir
gitdir  = git -C <path> rev-parse --path-format=absolute --git-dir
branch  = git -C <path> branch --show-current

isWorktree   = gitdir !== common    # linked worktree 时 gitdir = <main>/.git/worktrees/<name>
worktreeName = basename(gitdir)     # 仅 isWorktree 时有意义
```

- 数据落在 `projects` 表（DDL 见 02-storage §3），`repoRoot`/`branch` 等仅作展示
- 刷新时机：session 创建时必刷；projects 列表加载时 `metaCheckedAt` 超过 10min 后台刷新
- 非 git 目录：正常项目，repo 元数据为 null

## 5. UI 呈现

- 项目选择器 / 会话列表：按 `repoRoot` 分组展示；非 git 目录归「无仓库」组
- worktree 行：`foo · worktree feature-a（branch: ft-auth）`
  主仓行：`foo · main worktree（branch: main）`
- session 永远属于具体 path（= 某个 worktree）；切 worktree = 切项目

## 6. 边界情况

| 情况 | 处理 |
|---|---|
| 同一 repo 多处 clone（非 worktree） | 同一套规则：folder as project；repoName 相同仅用于展示分组 |
| 非 git 目录 | 正常项目 |
| backfill 反解 cwd | **不要**从 session 目录名 `--<path>--` 反解（`/`→`-` 有歧义）；一律读 JSONL 首行 header 的 `cwd` 字段 |
| pi 对 symlink cwd 的处理 | 我们入口 realpath 后才传给 pi，pi 收到的已是真实路径（pi 自身行为待验证，见 06-todo） |

## 7. 未来增强（暂不实现）

- ~~`git worktree list` 扫描 → UI 快捷入口~~ → 已升级为完整编排层，见 [08-tasks.md](08-tasks.md)
- branch 变化时 badge 自动刷新
- 按 repo 聚合的跨 worktree 统计（token/cost 汇总视图）
