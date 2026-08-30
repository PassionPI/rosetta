import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { WsClientMessage } from "@rosetta/shared";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import { isAuthed } from "./auth/cookie.ts";
import { webDistDir } from "./config.ts";
import { coreRoutes } from "./routes/core.ts";
import { orchestratorRoutes } from "./routes/orchestrator.ts";
import { wsHub } from "./ws/hub.ts";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 64 * 1024 * 1024, logger: false });
  await app.register(cookie);
  await app.register(websocket);

  // 鉴权（md/04 §1）：/api/* 除 login 外全部校验
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (
      url.startsWith("/api") &&
      url !== "/api/auth/login" &&
      !isAuthed(req.headers.cookie)
    ) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  // WS（upgrade 时校验 cookie）
  app.get("/ws", { websocket: true }, (socket, req) => {
    if (!isAuthed(req.headers.cookie)) {
      socket.close(4001, "unauthorized");
      return;
    }
    const client = wsHub.add(socket);
    socket.on("message", (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as WsClientMessage;
        if (msg.type === "subscribe") wsHub.subscribe(client, msg.sessionId);
        else if (msg.type === "unsubscribe")
          wsHub.unsubscribe(client, msg.sessionId);
        else if (msg.type === "ping")
          socket.send(JSON.stringify({ kind: "pong" }));
      } catch {
        /* 忽略非法消息 */
      }
    });
  });

  await app.register(coreRoutes, { prefix: "/api" });
  await app.register(orchestratorRoutes, { prefix: "/api" });

  // 生产模式托管 web 产物（SPA fallback）
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
