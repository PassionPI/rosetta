import { git } from "../util/git.ts";

/** 同 repo git 写操作串行锁（md/08 §9） */
const locks = new Map<number, Promise<unknown>>();

export function withRepoLock<T>(repoId: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(repoId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(repoId, next.catch(() => {}));
  return next;
}

export async function hasRemote(wt: string): Promise<boolean> {
  return (await git(["remote"], wt)).trim().length > 0;
}

export async function worktreeIsDirty(wt: string): Promise<boolean> {
  return (await git(["status", "--porcelain"], wt)).trim().length > 0;
}

export async function currentBranch(wt: string): Promise<string> {
  return (await git(["rev-parse", "--abbrev-ref", "HEAD"], wt)).trim();
}

export async function headCommit(wt: string): Promise<string> {
  return (await git(["rev-parse", "HEAD"], wt)).trim();
}

/**
 * 验收流水线（md/08 §7）：add → commit → 记录 endCommit → push 当前分支。
 * 不直推 main、不 merge、不做任何强制清理。
 */
export async function commitAndPush(
  wt: string,
  message: string,
): Promise<{ endCommit: string; pushError: string | null; committed: boolean }> {
  await git(["add", "-A"], wt);
  const dirty = await worktreeIsDirty(wt);
  let committed = false;
  if (dirty) {
    await git(["commit", "-m", message], wt);
    committed = true;
  }
  const endCommit = await headCommit(wt);
  let pushError: string | null = null;
  if (await hasRemote(wt)) {
    try {
      await git(["push", "origin", "HEAD"], wt);
    } catch (e) {
      pushError = e instanceof Error ? e.message : String(e);
    }
  } else {
    pushError = "无 origin 远端，仅本地提交";
  }
  return { endCommit, pushError, committed };
}
