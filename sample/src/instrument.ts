// Browser-side instrumentation for the sample canvas app.
//
// Runs INSIDE the sample page (port 1421). Builds a plain-JSON description of
// an element and ships it to the Nia shell (port 1420) via postMessage, since
// the iframe is cross-origin and the shell cannot read its DOM directly.

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

export const NIA_SHELL_ORIGIN = "http://127.0.0.1:1420";

// Computed styles worth showing in the inspector. Kept small on purpose.
const STYLE_PROPS = [
  "display",
  "position",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "textAlign",
  "margin",
  "padding",
  "border",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gap",
] as const;

function describePart(el: Element): string {
  let part = el.tagName.toLowerCase();
  if (el.id) part += `#${el.id}`;
  for (const cls of el.classList) part += `.${cls}`;
  return part;
}

export function describeElement(el: Element): CanvasSelection {
  const rect = el.getBoundingClientRect();
  const round = (n: number) => Math.round(n * 10) / 10;

  const path: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    path.unshift(describePart(node));
    node = node.parentElement;
  }

  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
    );
    if (value) styles[prop] = value.trim();
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    classes: Array.from(el.classList),
    rect: { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) },
    path,
    selector: path.join(" > "),
    styles,
    text: ((el as HTMLElement).innerText || el.textContent || "").trim().slice(0, 140),
    sourceUrl: location.href,
  };
}

export function postSelection(selection: CanvasSelection) {
  window.parent.postMessage({ source: "nia-canvas", kind: "nia:select", selection }, NIA_SHELL_ORIGIN);
}

let highlighted: Element | null = null;

export function highlight(el: Element) {
  if (highlighted instanceof HTMLElement) highlighted.style.outline = "";
  highlighted = el;
  if (el instanceof HTMLElement) el.style.outline = "2px solid #d7a11c";
}

function inspectSelector(selector: string) {
  const el = selector ? document.querySelector(selector) : null;
  if (el) {
    highlight(el);
    postSelection(describeElement(el));
  }
}

// Call once from the sample app entrypoint.
export function initNiaCanvasBridge() {
  window.parent.postMessage(
    { source: "nia-canvas", kind: "nia:ready", url: location.href },
    NIA_SHELL_ORIGIN,
  );

  // Click-to-inspect: capture before React/app handlers, never navigate away.
  document.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const el = event.target instanceof Element ? event.target : document.body;
      highlight(el);
      postSelection(describeElement(el));
    },
    true,
  );

  // Let the shell request inspection of a specific selector (used for the
  // automatic end-to-end self-check, no click required).
  window.addEventListener("message", (event) => {
    if (event.origin !== NIA_SHELL_ORIGIN) return;
    const data = event.data as { source?: string; kind?: string; selector?: string };
    if (data?.source !== "nia-shell" || data?.kind !== "nia:inspect-request") return;
    inspectSelector(data.selector || "body");
  });

  // Escape hatch for console / CDP-driven inspection.
  (window as unknown as { __niaInspect: (s?: string) => CanvasSelection | null }).__niaInspect = (
    selector = "body",
  ) => {
    const el = document.querySelector(selector);
    return el ? describeElement(el) : null;
  };
}
