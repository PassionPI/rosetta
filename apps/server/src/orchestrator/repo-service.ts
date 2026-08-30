import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { repos, worktrees } from "../db/schema.ts";
import { git, gitTopLevel, realpath } from "../util/git.ts";
import { log } from "../util/log.ts";

interface WtBlock {
  path: string;
  branch: string | null;
}

/** 解析 `git worktree list --porcelain` 输出 */
export function parseWorktreeList(out: string): WtBlock[] {
  const blocks: WtBlock[] = [];
  let cur: Partial<WtBlock> | null = null;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("worktree ")) {
      if (cur?.path) blocks.push(cur as WtBlock);
      cur = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && cur) {
      cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
    // detached / HEAD 行忽略（branch 为 null）
  }
  if (cur?.path) blocks.push(cur as WtBlock);
  return blocks;
}

/**
 * 注册 repo（md/08 §3）。repoRoot 取 git-common-dir 的父目录（= 主仓 worktree 路径），
 * 这样从任何 worktree/子目录注册都会归到同一 repo 身份。
 * 注意：不能用 --show-toplevel——在 worktree 内它返回 worktree 自身。
 */
export async function registerRepo(inputPath: string): Promise<number> {
  const abs = realpath(inputPath);
  const top = await gitTopLevel(abs);
  if (!top) throw new Error(`${abs} 不是 git 仓库`);

  let repoRoot: string;
  try {
    const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], abs)).trim();
    // common = <主仓>/.git；bare 仓库（common 无 /.git 后缀）回退 toplevel
    repoRoot = common.endsWith("/.git") ? realpath(path.dirname(common)) : realpath(top);
  } catch {
    repoRoot = realpath(top);
  }

  let repo = db.select().from(repos).where(eq(repos.repoRoot, repoRoot)).get();
  if (!repo) {
    db.insert(repos)
      .values({ repoRoot, displayName: path.basename(repoRoot), createdAt: Date.now() })
      .run();
    repo = db.select().from(repos).where(eq(repos.repoRoot, repoRoot)).get()!;
    log.info(`[repo] 注册 ${repoRoot}`);
  }
  await refreshWorktrees(repo.id, repoRoot);
  return repo.id;
}

export async function refreshWorktrees(repoId: number, repoRoot: string): Promise<void> {
  const blocks = parseWorktreeList(await git(["worktree", "list", "--porcelain"], repoRoot));
  const existing = db.select().from(worktrees).where(eq(worktrees.repoId, repoId)).all();
  const existingPaths = new Set(existing.map((w) => w.path));
  // main 固定 slot 1；linked 从 max(existing, 1) 递增，避免与 main 撞号
  let nextOrder = existing.reduce((m, w) => Math.max(m, w.slotOrder), 1);

  for (const b of blocks) {
    const p = realpath(b.path);
    const isMain = p === repoRoot;
    if (existingPaths.has(p)) {
      db.update(worktrees).set({ branch: b.branch, updatedAt: Date.now() }).where(eq(worktrees.path, p)).run();
      continue;
    }
    db.insert(worktrees)
      .values({
        path: p,
        repoId,
        name: isMain ? "main" : path.basename(p),
        isMain,
        branch: b.branch,
        slotOrder: isMain ? 1 : ++nextOrder,
        status: "idle",
        updatedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
  }
}

/** 新建 worktree（挂在 repoRoot 同级目录） */
export async function addWorktree(repoId: number, repoRoot: string, name: string, base?: string): Promise<string> {
  const target = path.resolve(repoRoot, "..", name);
  await git(base ? ["worktree", "add", base, target] : ["worktree", "add", target], repoRoot);
  await refreshWorktrees(repoId, repoRoot);
  return target;
}
