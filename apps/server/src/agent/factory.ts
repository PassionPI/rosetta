import {
  ModelRuntime,
  createAgentSession,
  resolveCliModel,
  type AgentSession,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** 06-todo 已确认：默认工具集（含只读排查三件套） */
export const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

let modelRuntimePromise: Promise<ModelRuntime> | null = null;

/** 全局懒加载 ModelRuntime（复用 ~/.pi/agent 的凭证与模型目录） */
export function getModelRuntime(): Promise<ModelRuntime> {
  modelRuntimePromise ??= ModelRuntime.create();
  return modelRuntimePromise;
}

export interface BuildSessionOptions {
  cwd: string;
  /** "provider/model:thinking" 形式；缺省用 pi 设置里的默认模型 */
  modelSpec?: string;
  tools?: string[];
  customTools?: ToolDefinition[];
  sessionManager: CreateAgentSessionOptions["sessionManager"];
}

/**
 * 创建 AgentSession（md/01 §3.5 pi 环境零定制：默认 agentDir / settings / extensions 发现）。
 * 骨架阶段不做 runtime 级会话替换（fork/switch），Registry 每会话独立创建。
 */
export async function buildSession(opts: BuildSessionOptions): Promise<{
  session: AgentSession;
  modelFallbackMessage?: string;
}> {
  const modelRuntime = await getModelRuntime();
  const options: CreateAgentSessionOptions = {
    cwd: opts.cwd,
    modelRuntime,
    tools: opts.tools ?? DEFAULT_TOOLS,
    customTools: opts.customTools,
    sessionManager: opts.sessionManager,
  };

  if (opts.modelSpec) {
    const resolved = resolveCliModel({ cliModel: opts.modelSpec, modelRuntime });
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error ?? `无法解析模型: ${opts.modelSpec}`);
    }
    options.model = resolved.model;
    if (resolved.thinkingLevel) options.thinkingLevel = resolved.thinkingLevel;
  }

  const result = await createAgentSession(options);
  return { session: result.session, modelFallbackMessage: result.modelFallbackMessage };
}
