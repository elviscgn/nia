import { invoke } from "@tauri-apps/api/core";
import type { CanvasSelection } from "./canvas";
import type { ScratchDocument } from "./scratch";

export type ScratchAgentSelection = {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  styles: Record<string, string>;
};

export type ScratchAgentRequest = ScratchDocument & {
  prompt: string;
  vision: string;
  selection: ScratchAgentSelection | null;
};

export type ScratchAgentResponse = ScratchDocument & {
  summary: string;
  model: string;
  latencyMs: number;
};

export function selectionForScratchAgent(selection: CanvasSelection | null): ScratchAgentSelection | null {
  if (!selection || selection.sourceUrl !== "scratch://index.html") return null;
  return {
    selector: selection.selector,
    tag: selection.tag,
    id: selection.id,
    classes: selection.classes,
    text: selection.text,
    styles: selection.styles,
  };
}

export const scratchAgentRun = (request: ScratchAgentRequest) =>
  invoke<ScratchAgentResponse>("scratch_agent_run", { request });
