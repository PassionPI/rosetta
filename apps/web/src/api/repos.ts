import type { RepoDTO } from "@rosetta/shared";
import { fx } from "./client.ts";

export interface RegisterRepoInput {
  path: string;
}

export interface AddWorktreeInput {
  name: string;
  base?: string;
}

export interface SetRepoModelInput {
  /** 空串清除默认模型 */
  model: string;
}

export interface SetRepoModelOutput {
  ok: boolean;
  defaultModel: string | null;
}

export const registerRepo = (input: RegisterRepoInput) =>
  fx<{ id: number }>({ url: "/api/repos", method: "POST", body: input });

export const listRepos = () => fx<RepoDTO[]>({ url: "/api/repos" });

export const addWorktree = (repoId: number, input: AddWorktreeInput) =>
  fx<{ path: string }>({
    url: `/api/repos/${repoId}/worktrees`,
    method: "POST",
    body: input,
  });

export const refreshRepo = (repoId: number) =>
  fx<RepoDTO>({ url: `/api/repos/${repoId}/refresh`, method: "POST" });

export const setRepoModel = (repoId: number, input: SetRepoModelInput) =>
  fx<SetRepoModelOutput>({
    url: `/api/repos/${repoId}/model`,
    method: "POST",
    body: input,
  });

export interface ReserveWorktreeInput {
  path: string;
  /** true 占用（不参与派发）；false 释放 */
  reserved: boolean;
}

export const reserveWorktree = (repoId: number, input: ReserveWorktreeInput) =>
  fx<{ ok: boolean; status: string }>({
    url: `/api/repos/${repoId}/worktrees/reserve`,
    method: "POST",
    body: input,
  });
