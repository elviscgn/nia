import { invoke } from "@tauri-apps/api/core";

export type CanvasRect = { x: number; y: number; width: number; height: number };
export type CanvasMode = "inspect" | "interact";

export type CanvasStyleTarget = {
  file: string;
  selector: string;
  property: string;
  value: string;
  important: boolean;
  classToken?: string;
};

export type CanvasSourceRef = {
  file: string;
  line: number;
  column: number;
  styleFile: string;
  styleSelector: string;
  styleLine: number;
  classFile?: string;
  classLine?: number;
  classColumn?: number;
  classValue?: string;
};

export type CanvasSelection = {
  tag: string;
  id: string;
  classes: string[];
  rect: CanvasRect;
  path: string[];
  selector: string;
  styles: Record<string, string>;
  styleTargets: Record<string, CanvasStyleTarget>;
  text: string;
  sourceUrl: string;
  source: CanvasSourceRef | null;
};

export type CanvasStatus = { url: string; reachable: boolean; latencyMs: number };

export type CanvasStylePatchResult = {
  file: string;
  selector: string;
  property: string;
  previousValue: string | null;
  value: string;
  undoDepth: number;
};

export type CanvasUndoResult = {
  file: string;
  selector: string;
  property: string;
  restoredValue: string | null;
  undoDepth: number;
};

export type CanvasHistoryState = {
  undoDepth: number;
};

export type StyleIndexState = {
  version: number;
  fileCount: number;
  ruleCount: number;
};

export const CANVAS_ORIGIN = "http://127.0.0.1:1421";

export const canvasSampleUrl = () => invoke<string>("canvas_sample_url");
export const canvasStatus = () => invoke<CanvasStatus>("canvas_status");

export const canvasReportSelection = (selection: CanvasSelection) =>
  invoke<CanvasSelection>("canvas_report_selection", { selection });

export const canvasSelection = () => invoke<CanvasSelection | null>("canvas_selection");
export const canvasClearSelection = () => invoke<void>("canvas_clear_selection");
export const canvasHistoryState = () => invoke<CanvasHistoryState>("canvas_history_state");
export const canvasStyleIndexState = () => invoke<StyleIndexState>("canvas_style_index_state");
export const canvasUndoStyle = () => invoke<CanvasUndoResult>("canvas_undo_style");

export const canvasCdpEvaluate = (expression: string) =>
  invoke<unknown>("canvas_cdp_evaluate", { expression });

export const canvasSetStylePx = (
  file: string,
  selector: string,
  property: string,
  valuePx: number,
) => invoke<CanvasStylePatchResult>("canvas_set_style_px", { file, selector, property, valuePx });

export const canvasReplaceClassToken = (
  file: string,
  line: number,
  column: number,
  expectedClassValue: string,
  oldToken: string,
  newToken: string,
) => invoke<CanvasStylePatchResult>("canvas_replace_class_token", {
  file,
  line,
  column,
  expectedClassValue,
  oldToken,
  newToken,
});

export type CanvasInbound =
  | { kind: "nia:ready"; url: string }
  | { kind: "nia:select"; selection: CanvasSelection };

export function parseCanvasMessage(event: MessageEvent): CanvasInbound | null {
  if (event.origin !== CANVAS_ORIGIN && event.origin !== "null") return null;
  const data = event.data as {
    source?: string;
    kind?: string;
    selection?: CanvasSelection;
    url?: string;
  };
  if (data?.source !== "nia-canvas") return null;
  if (data.kind === "nia:ready") return { kind: "nia:ready", url: data.url ?? "" };
  if (data.kind === "nia:select" && data.selection) {
    return { kind: "nia:select", selection: data.selection };
  }
  return null;
}

export function setCanvasMode(
  iframe: HTMLIFrameElement | null,
  mode: CanvasMode,
  targetOrigin = CANVAS_ORIGIN,
) {
  iframe?.contentWindow?.postMessage(
    { source: "nia-shell", kind: "nia:mode", mode },
    targetOrigin,
  );
}

export function requestCanvasInspect(
  iframe: HTMLIFrameElement | null,
  selector: string,
  targetOrigin = CANVAS_ORIGIN,
) {
  iframe?.contentWindow?.postMessage(
    { source: "nia-shell", kind: "nia:inspect-request", selector },
    targetOrigin,
  );
}

export function previewCanvasStyle(
  iframe: HTMLIFrameElement | null,
  selector: string,
  property: string,
  value: string,
  inspectSelector: string,
  targetOrigin = CANVAS_ORIGIN,
) {
  iframe?.contentWindow?.postMessage(
    {
      source: "nia-shell",
      kind: "nia:style-preview",
      selector,
      property,
      value,
      inspectSelector,
    },
    targetOrigin,
  );
}

export function clearCanvasStylePreview(
  iframe: HTMLIFrameElement | null,
  targetOrigin = CANVAS_ORIGIN,
) {
  iframe?.contentWindow?.postMessage(
    { source: "nia-shell", kind: "nia:style-preview-clear" },
    targetOrigin,
  );
}
