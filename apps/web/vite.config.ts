import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 9999,
    host: true, // 暴露到局域网（dev server 上开发、本地浏览器访问）
    proxy: {
      "/api": "http://localhost:3173",
      "/ws": { target: "ws://localhost:3173", ws: true },
    },
  },
});
