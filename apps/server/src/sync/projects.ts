import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { projects } from "../db/schema.ts";
import { git, gitTopLevel, realpath } from "../util/git.ts";

/**
 * folder as project（md/07）：projects.path = realpath(cwd) 为唯一键；
 * git 元数据仅展示用，绝不参与身份归并。
 */
export async function upsertProject(cwd: string): Promise<void> {
  const p = realpath(cwd);
  const existing = db.select().from(projects).where(eq(projects.path, p)).get();
  if (existing) {
    db.update(projects).set({ lastActiveAt: Date.now() }).where(eq(projects.path, p)).run();
    return;
  }
  const meta = await detectProjectMeta(p);
  db.insert(projects)
    .values({
      path: p,
      displayName: path.basename(p),
      repoRoot: meta.repoRoot,
      repoName: meta.repoRoot ? path.basename(meta.repoRoot) : null,
      isWorktree: meta.isWorktree,
      worktreeName: meta.worktreeName,
      branch: meta.branch,
      lastActiveAt: Date.now(),
      metaCheckedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

interface ProjectMeta {
  repoRoot: string | null;
  isWorktree: boolean | null;
  worktreeName: string | null;
  branch: string | null;
}

async function detectProjectMeta(p: string): Promise<ProjectMeta> {
  const top = await gitTopLevel(p);
  if (!top) return { repoRoot: null, isWorktree: null, worktreeName: null, branch: null };
  const repoRoot = realpath(top);
  let isWorktree: boolean | null = null;
  let worktreeName: string | null = null;
  try {
    const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], p)).trim();
    const gitdir = (await git(["rev-parse", "--path-format=absolute", "--git-dir"], p)).trim();
    isWorktree = common !== gitdir;
    if (isWorktree) worktreeName = path.basename(gitdir);
  } catch {
    /* 非 git 或 git 不可用：元数据留空 */
  }
  let branch: string | null = null;
  try {
    branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], p)).trim() || null;
  } catch {
    /* 空仓库 */
  }
  return { repoRoot, isWorktree, worktreeName, branch };
}

/** 列表加载时刷新过期元数据（>10min） */
export async function refreshStaleProjects(maxAgeMs = 10 * 60_000): Promise<void> {
  const rows = db.select().from(projects).all();
  const now = Date.now();
  await Promise.all(
    rows
      .filter((r) => !r.metaCheckedAt || now - r.metaCheckedAt > maxAgeMs)
      .map(async (r) => {
        const meta = await detectProjectMeta(r.path).catch(() => null);
        if (!meta) return;
        db.update(projects)
          .set({
            repoRoot: meta.repoRoot,
            repoName: meta.repoRoot ? path.basename(meta.repoRoot) : null,
            isWorktree: meta.isWorktree,
            worktreeName: meta.worktreeName,
            branch: meta.branch,
            metaCheckedAt: now,
          })
          .where(eq(projects.path, r.path))
          .run();
      }),
  );
}
