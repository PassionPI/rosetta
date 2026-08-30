import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录（src/ 与 dist/ 同深度，两种运行方式均成立） */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const config = {
  port: Number(process.env.HARNESS_PORT ?? 3173),
  host: process.env.HARNESS_HOST ?? "0.0.0.0",
  /** 登录密码；为空时 server 照常启动但拒绝登录并打警告 */
  password: process.env.HARNESS_PASSWORD ?? "",
  dataDir: path.resolve(process.env.HARNESS_DATA_DIR ?? path.join(repoRoot, "data")),
  cookieName: "rossetta_session",
  /** 空闲会话 dispose 阈值（06-todo：暂定 30min） */
  idleDisposeMs: 30 * 60_000,
};

export const dbPath = path.join(config.dataDir, "harness.db");
export const secretPath = path.join(config.dataDir, "secret.key");
export const webDistDir = path.join(repoRoot, "apps", "web", "dist");

fs.mkdirSync(config.dataDir, { recursive: true });
