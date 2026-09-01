import type { EntryDTO, SessionSummary, ToolInfo } from "@rosetta/shared";
import { fx } from "./client.ts";

export interface CreateSessionInput {
  cwd: string;
  name?: string;
  model?: string;
}

export type SessionDetail = SessionSummary & { streaming?: boolean };

export interface PromptInput {
  text: string;
  images?: Array<{ mediaType: string; data: string }>;
  streamingBehavior?: "steer" | "followUp";
}

export interface SetModelInput {
  /** provider/model[:thinking] */
  model: string;
}

export interface SetModelOutput {
  ok: boolean;
  provider: string;
  modelId: string;
  thinkingLevel: string;
}

export const listSessions = (cwd?: string) =>
  fx<SessionSummary[]>({ url: "/api/sessions", search: { cwd } });

export const createSession = (input: CreateSessionInput) =>
  fx<SessionSummary>({ url: "/api/sessions", method: "POST", body: input });

export const getSession = (sessionId: string) =>
  fx<SessionDetail>({ url: `/api/sessions/${sessionId}` });

export const listEntries = (sessionId: string) =>
  fx<EntryDTO[]>({ url: `/api/sessions/${sessionId}/entries` });

export const listSessionTools = (sessionId: string) =>
  fx<ToolInfo[]>({ url: `/api/sessions/${sessionId}/tools` });

export const promptSession = (sessionId: string, input: PromptInput) =>
  fx<{ runId: number }>({
    url: `/api/sessions/${sessionId}/prompt`,
    method: "POST",
    body: input,
  });

export const steerSession = (sessionId: string, input: { text: string }) =>
  fx<{ ok: boolean }>({
    url: `/api/sessions/${sessionId}/steer`,
    method: "POST",
    body: input,
  });

export const followUpSession = (sessionId: string, input: { text: string }) =>
  fx<{ ok: boolean }>({
    url: `/api/sessions/${sessionId}/followup`,
    method: "POST",
    body: input,
  });

export const abortSession = (sessionId: string) =>
  fx<{ ok: boolean }>({
    url: `/api/sessions/${sessionId}/abort`,
    method: "POST",
  });

export const compactSession = (
  sessionId: string,
  input?: { instructions?: string },
) =>
  fx<{ ok: boolean; tokensBefore?: number }>({
    url: `/api/sessions/${sessionId}/compact`,
    method: "POST",
    body: input,
  });

export const renameSession = (sessionId: string, input: { name: string }) =>
  fx<{ ok: boolean }>({
    url: `/api/sessions/${sessionId}/name`,
    method: "PATCH",
    body: input,
  });

export const setSessionModel = (sessionId: string, input: SetModelInput) =>
  fx<SetModelOutput>({
    url: `/api/sessions/${sessionId}/model`,
    method: "POST",
    body: input,
  });
