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
  const committed = await stageAndCommit(wt, message);
  const endCommit = await headCommit(wt);
  const pushError = await pushCurrent(wt);
  return { endCommit, pushError, committed };
}

/** stage 全部改动并 commit；无改动则跳过。返回是否产生了提交 */
export async function stageAndCommit(wt: string, message: string): Promise<boolean> {
  await git(["add", "-A"], wt);
  if (!(await worktreeIsDirty(wt))) return false;
  await git(["commit", "-m", message], wt);
  return true;
}

/** push 当前分支；返回错误信息（无远端/失败），成功为 null */
export async function pushCurrent(wt: string): Promise<string | null> {
  if (!(await hasRemote(wt))) return "无 origin 远端，仅本地提交";
  try {
    await git(["push", "origin", "HEAD"], wt);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
