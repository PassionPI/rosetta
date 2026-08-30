import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dbPath } from "../config.ts";
import * as schema from "./schema.ts";

export const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

function resolveMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "migrations"), // tsx 直跑 src/db/index.ts
    path.resolve(here, "../src/db/migrations"), // tsup bundle：dist/index.js → ../src
    path.resolve(process.cwd(), "src/db/migrations"), // 兜底：cwd = apps/server
  ];
  for (const c of candidates) if (fs.existsSync(path.join(c, "meta", "_journal.json"))) return c;
  return candidates[0];
}

export function runMigrations(): void {
  migrate(db, { migrationsFolder: resolveMigrationsDir() });
}
