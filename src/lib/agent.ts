import { invoke } from "@tauri-apps/api/core";
import type { ScratchDocument } from "./scratch";

export type ScratchAgentRequest = {
  prompt: string;
  vision: string;
};

export type ScratchAgentResponse = {
  document: ScratchDocument;
  summary: string;
  model: string;
  latencyMs: number;
  undoDepth: number;
  version: number;
};

export const scratchAgentRun = (request: ScratchAgentRequest) =>
  invoke<ScratchAgentResponse>("scratch_agent_run", { request });
