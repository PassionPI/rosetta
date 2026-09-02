import crypto from "node:crypto";
import fs from "node:fs";
import { config, secretPath } from "../config.ts";

function loadSecret(): Buffer {
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath);
  const s = crypto.randomBytes(32);
  fs.writeFileSync(secretPath, s, { mode: 0o600 });
  return s;
}
const secret = loadSecret();

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** HMAC 签名 token：base64url(payload).base64url(mac) */
export function issueToken(): string {
  const body = Buffer.from(
    JSON.stringify({ exp: Date.now() + TTL_MS }),
  ).toString("base64url");
  const mac = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [body, mac] = token.split(".");
  if (!body || !mac) return false;
  const expect = crypto.createHmac("sha256", secret).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return false;
  }
  if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got))
    return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      exp: number;
    };
    return Date.now() < exp;
  } catch {
    return false;
  }
}

/** 明文密码比较（等长哈希后 timingSafeEqual） */
export function checkPassword(input: string): boolean {
  if (!config.password) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(config.password).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isAuthed(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  const m = /(?:^|;\s*)rosetta_session=([^;]+)/.exec(cookieHeader);
  return verifyToken(m?.[1]);
}

export { config };
