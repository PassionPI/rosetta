import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录（src/ 与 dist/ 同深度，两种运行方式均成立） */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** 加载 KEY=VALUE 环境文件；已存在的环境变量不覆盖（systemd EnvironmentFile / start.sh 优先） */
function loadEnvFile(file: string): void {
  try {
    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(m[1]! in process.env)) process.env[m[1]!] = value;
    }
  } catch {
    /* 文件不存在则忽略 */
  }
}
loadEnvFile(path.join(repoRoot, ".env"));
loadEnvFile(path.join(repoRoot, "script", "env"));

/** 相对路径按仓库根解析，避免随启动 cwd 漂移 */
function resolveFromRepoRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}

export const config = {
  port: Number(process.env.HARNESS_PORT ?? 3173),
  host: process.env.HARNESS_HOST ?? "0.0.0.0",
  /** 登录密码；为空时 server 照常启动但拒绝登录并打警告 */
  password: process.env.HARNESS_PASSWORD ?? "",
  dataDir: resolveFromRepoRoot(process.env.HARNESS_DATA_DIR ?? "data"),
  cookieName: "rossetta_session",
  /** 空闲会话 dispose 阈值（06-todo：暂定 30min） */
  idleDisposeMs: 30 * 60_000,
};

export const dbPath = path.join(config.dataDir, "harness.db");
export const secretPath = path.join(config.dataDir, "secret.key");
export const webDistDir = path.join(repoRoot, "apps", "web", "dist");

fs.mkdirSync(config.dataDir, { recursive: true });
