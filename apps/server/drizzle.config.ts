import { defineConfig } from "drizzle-kit";
import { dbPath } from "./src/config.ts";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: dbPath },
});
