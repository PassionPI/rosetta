import type { ModelInfo, ProjectDTO } from "@rosetta/shared";
import { fx } from "./client.ts";

export const listProjects = () => fx<ProjectDTO[]>({ url: "/api/projects" });

export const listModels = () => fx<ModelInfo[]>({ url: "/api/models" });
