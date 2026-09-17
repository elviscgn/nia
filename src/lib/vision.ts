import { invoke } from "@tauri-apps/api/core";

export type VisionContext = {
  description: string;
  references: string[];
  scope: string;
  version: number;
};

export const visionGet = () =>
  invoke<VisionContext>("vision_get");

export const visionSave = (description: string, references: string[]) =>
  invoke<VisionContext>("vision_save", {
    input: { description, references },
  });
