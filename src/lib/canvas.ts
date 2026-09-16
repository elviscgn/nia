import { invoke } from "@tauri-apps/api/core";

export type CanvasRect = { x: number; y: number; width: number; height: number };

export type CanvasSelection = {
  tag: string;
  id: string;
  classes: string[];
  rect: CanvasRect;
  path: string[];
  selector: string;
  styles: Record<string, string>;
  text: string;
  sourceUrl: string;
};

export type CanvasStatus = { url: string; reachable: boolean; latencyMs: number };

export const CANVAS_ORIGIN = "http://127.0.0.1:1421";

export const canvasSampleUrl = () => invoke<string>("canvas_sample_url");
export const canvasStatus = () => invoke<CanvasStatus>("canvas_status");

// Round-trip through Rust on purpose: the shell reports the selection, then
// reads it back, so the inspector always renders what Rust holds.
export async function canvasReportSelection(selection: CanvasSelection) {
  await invoke("canvas_report_selection", { selection });
  return invoke<CanvasSelection | null>("canvas_selection");
}

export const canvasSelection = () => invoke<CanvasSelection | null>("canvas_selection");
export const canvasClearSelection = () => invoke<void>("canvas_clear_selection");

// Arbitrary JS evaluated in the Nia webview via the CEF DevTools protocol
// (Runtime.evaluate, returnByValue). Proves the Rust CDP path end to end.
export const canvasCdpEvaluate = (expression: string) =>
  invoke<unknown>("canvas_cdp_evaluate", { expression });

export type CanvasInbound =
  | { kind: "nia:ready"; url: string }
  | { kind: "nia:select"; selection: CanvasSelection };

export function parseCanvasMessage(event: MessageEvent): CanvasInbound | null {
  if (event.origin !== CANVAS_ORIGIN) return null;
  const data = event.data as { source?: string; kind?: string; selection?: CanvasSelection; url?: string };
  if (data?.source !== "nia-canvas") return null;
  if (data.kind === "nia:ready") return { kind: "nia:ready", url: data.url ?? "" };
  if (data.kind === "nia:select" && data.selection) return { kind: "nia:select", selection: data.selection };
  return null;
}

export function requestCanvasInspect(iframe: HTMLIFrameElement | null, selector: string) {
  iframe?.contentWindow?.postMessage(
    { source: "nia-shell", kind: "nia:inspect-request", selector },
    CANVAS_ORIGIN,
  );
}
