import { createFetch, Middleware } from "@/lib/fx.ts";

const isPlainObject = (b: unknown): b is object =>
  b != null &&
  typeof b === "object" &&
  !(b instanceof FormData) &&
  !(b instanceof Blob) &&
  !(b instanceof URLSearchParams) &&
  !(b instanceof ArrayBuffer);

/** 对象 body 自动补 application/json 头（api 层无需再传 headers） */
const jsonHeader: Middleware = (ctx, next) => {
  if (isPlainObject(ctx.body) && !ctx.headers.has("content-type")) {
    ctx.headers.set("content-type", "application/json");
  }
  return next();
};

/** 全局请求器（lib/fx.ts，洋葱中间件 + tuple result），API 定义处直接调用 fx() */
export const fx = createFetch(jsonHeader);
