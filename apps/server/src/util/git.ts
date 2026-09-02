import { execFile } from "node:child_process";
import fs from "node:fs";

/** 执行 git 命令，失败时抛错（含 stderr） */
export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err)
          reject(
            new Error(
              `git ${args.join(" ")} 失败: ${stderr.toString().trim() || err.message}`,
            ),
          );
        else resolve(stdout.toString());
      },
    );
  });
}

export function realpath(p: string): string {
  return fs.realpathSync(p);
}

/** 是否为 git 仓库（且返回 toplevel） */
export async function gitTopLevel(p: string): Promise<string | null> {
  try {
    const top = await git(["rev-parse", "--show-toplevel"], p);
    return top.trim() || null;
  } catch {
    return null;
  }
}
