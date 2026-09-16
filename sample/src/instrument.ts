// Browser-side instrumentation for the sample canvas app.
// Runs inside the sample page and reports plain JSON back to the Nia shell.

export type CanvasRect = { x: number; y: number; width: number; height: number };

export type CanvasSourceRef = {
  file: string;
  line: number;
  column: number;
  styleFile: string;
  styleSelector: string;
  styleLine: number;
};

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
  source: CanvasSourceRef | null;
};

export const NIA_SHELL_ORIGIN = "http://127.0.0.1:1420";

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
  "borderRadius",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gap",
] as const;

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function describePart(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${cssEscape(el.id)}`;

  const classes = Array.from(el.classList)
    .map((className) => `.${cssEscape(className)}`)
    .join("");
  const siblings = el.parentElement
    ? Array.from(el.parentElement.children).filter((node) => node.tagName === el.tagName)
    : [];
  const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(el) + 1})` : "";
  return `${tag}${classes}${nth}`;
}

function sourceFor(el: Element): CanvasSourceRef | null {
  const owner = el.closest<HTMLElement>("[data-nia-source-file]");
  if (!owner) return null;

  const file = owner.dataset.niaSourceFile ?? "";
  const line = Number.parseInt(owner.dataset.niaSourceLine ?? "0", 10);
  const column = Number.parseInt(owner.dataset.niaSourceColumn ?? "0", 10);

  return {
    file,
    line: Number.isFinite(line) ? line : 0,
    column: Number.isFinite(column) ? column : 0,
    styleFile: "",
    styleSelector: "",
    styleLine: 0,
  };
}

export function describeElement(el: Element): CanvasSelection {
  const rect = el.getBoundingClientRect();
  const round = (value: number) => Math.round(value * 10) / 10;

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
      prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`),
    );
    if (value) styles[prop] = value.trim();
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    classes: Array.from(el.classList),
    rect: {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
    },
    path,
    selector: path.join(" > "),
    styles,
    text: ((el as HTMLElement).innerText || el.textContent || "").trim().slice(0, 140),
    sourceUrl: location.href,
    source: sourceFor(el),
  };
}

export function postSelection(selection: CanvasSelection) {
  window.parent.postMessage(
    { source: "nia-canvas", kind: "nia:select", selection },
    NIA_SHELL_ORIGIN,
  );
}

let highlighted: Element | null = null;
let overlay: HTMLDivElement | null = null;
let previewStyle: HTMLStyleElement | null = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.setAttribute("data-nia-overlay", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "2147483647",
    border: "2px solid #d7a11c",
    boxSizing: "border-box",
  });
  document.documentElement.appendChild(overlay);
  return overlay;
}

function ensurePreviewStyle() {
  if (previewStyle) return previewStyle;
  previewStyle = document.createElement("style");
  previewStyle.setAttribute("data-nia-style-preview", "true");
  document.head.appendChild(previewStyle);
  return previewStyle;
}

function positionOverlay() {
  if (!highlighted) return;
  const rect = highlighted.getBoundingClientRect();
  const target = ensureOverlay();
  target.style.left = `${rect.left}px`;
  target.style.top = `${rect.top}px`;
  target.style.width = `${rect.width}px`;
  target.style.height = `${rect.height}px`;
}

export function highlight(el: Element) {
  highlighted = el;
  positionOverlay();
}

function inspectSelector(selector: string) {
  const el = selector ? document.querySelector(selector) : null;
  if (!el) return;
  highlight(el);
  postSelection(describeElement(el));
}

function previewStyleChange(
  selector: string,
  property: string,
  value: string,
  inspectTarget: string,
) {
  if (!selector.trim() || !/^[a-z-]+$/i.test(property) || !/^-?\d+(?:\.\d+)?px$/.test(value)) {
    return;
  }

  const style = ensurePreviewStyle();
  style.textContent = `${selector} { ${property}: ${value} !important; }`;

  requestAnimationFrame(() => {
    inspectSelector(inspectTarget || selector);
  });
}

function clearStylePreview() {
  if (previewStyle) previewStyle.textContent = "";
  requestAnimationFrame(positionOverlay);
}

export function initNiaCanvasBridge() {
  window.parent.postMessage(
    { source: "nia-canvas", kind: "nia:ready", url: location.href },
    NIA_SHELL_ORIGIN,
  );

  document.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const el = event.target instanceof Element ? event.target : document.body;
      if (el === overlay) return;
      highlight(el);
      postSelection(describeElement(el));
    },
    true,
  );

  window.addEventListener("message", (event) => {
    if (event.origin !== NIA_SHELL_ORIGIN) return;
    const data = event.data as {
      source?: string;
      kind?: string;
      selector?: string;
      property?: string;
      value?: string;
      inspectSelector?: string;
    };
    if (data?.source !== "nia-shell") return;

    if (data.kind === "nia:inspect-request") {
      inspectSelector(data.selector || "body");
      return;
    }

    if (data.kind === "nia:style-preview") {
      previewStyleChange(
        data.selector || "",
        data.property || "",
        data.value || "",
        data.inspectSelector || data.selector || "body",
      );
      return;
    }

    if (data.kind === "nia:style-preview-clear") {
      clearStylePreview();
    }
  });

  window.addEventListener("resize", positionOverlay);
  window.addEventListener("scroll", positionOverlay, true);

  (window as unknown as { __niaInspect: (selector?: string) => CanvasSelection | null }).__niaInspect = (
    selector = "body",
  ) => {
    const el = document.querySelector(selector);
    return el ? describeElement(el) : null;
  };
}
