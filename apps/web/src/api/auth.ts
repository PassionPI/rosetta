import { fx } from "./client.ts";

export interface LoginInput {
  password: string;
}

export interface LoginOutput {
  ok: boolean;
}

export const login = (input: LoginInput) =>
  fx<LoginOutput>({ url: "/api/auth/login", method: "POST", body: input });

export const me = () => fx<LoginOutput>({ url: "/api/auth/me" });
