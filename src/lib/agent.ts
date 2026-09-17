import { invoke } from "@tauri-apps/api/core";
import type { ScratchDocument } from "./scratch";

export type ScratchAgentRequest = {
  prompt: string;
};

export type ScratchChatEntry = {
  role: "user" | "assistant" | "error";
  text: string;
  meta: string | null;
};

export type ScratchAgentResponse = {
  document: ScratchDocument;
  summary: string;
  model: string;
  latencyMs: number;
  undoDepth: number;
  version: number;
  history: ScratchChatEntry[];
};

export const scratchAgentRun = (request: ScratchAgentRequest) =>
  invoke<ScratchAgentResponse>("scratch_agent_run", { request });

export const scratchAgentHistory = () =>
  invoke<ScratchChatEntry[]>("scratch_agent_history");

export const scratchAgentClearHistory = () =>
  invoke<ScratchChatEntry[]>("scratch_agent_clear_history");
