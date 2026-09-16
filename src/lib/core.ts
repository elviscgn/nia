import { invoke } from "@tauri-apps/api/core";

export type CoreHealth = { name: string; runtime: string; uptime_ms: number };
export const coreHealth = () => invoke<CoreHealth>("core_health");
export async function coreRoundTrip() {
  const started = performance.now();
  await invoke("ping");
  return performance.now() - started;
}
