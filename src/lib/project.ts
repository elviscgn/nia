import { invoke } from "@tauri-apps/api/core";

export type ProjectSession = {
  root: string;
  name: string;
  packageManager: string | null;
  framework: string | null;
  devScript: string | null;
  devCommand: string | null;
  scripts: string[];
  version: number;
};

export function projectGet() {
  return invoke<ProjectSession>("project_get");
}

export function projectOpen(root: string) {
  return invoke<ProjectSession>("project_open", { root });
}

export function projectPickFolder() {
  return invoke<ProjectSession | null>("project_pick_folder");
}
