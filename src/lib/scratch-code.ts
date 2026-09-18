import { invoke } from "@tauri-apps/api/core";
import type { ScratchSnapshot } from "./scratch";

export type ScratchPart = "html" | "css" | "js";

export const scratchEditPart = (part: ScratchPart, content: string) =>
  invoke<ScratchSnapshot>("scratch_edit_part", {
    edit: { part, content },
  });
