// Browser-side instrumentation for the sample canvas app.
// Runs inside the sample page and reports plain JSON back to the Nia shell.

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

const EDITABLE_STYLE_PROPS = [
  "font-size",
  "gap",
  "border-radius",
  "padding",
  "margin-top",
  "margin-bottom",
] as const;

type Specificity = [number, number, number];
type StyleCandidate = CanvasStyleTarget & { specificity: Specificity; order: number };

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function classTokenForSelector(selector: string, el: Element): string | undefined {
  for (const className of Array.from(el.classList)) {
    const escaped = `.${cssEscape(className)}`;
    if (selector === escaped || selector.startsWith(`${escaped}:`)) return className;
  }
  return undefined;
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
  const classLine = Number.parseInt(owner.dataset.niaClassLine ?? "0", 10);
  const classColumn = Number.parseInt(owner.dataset.niaClassColumn ?? "0", 10);

  return {
    file,
    line: Number.isFinite(line) ? line : 0,
    column: Number.isFinite(column) ? column : 0,
    styleFile: "",
    styleSelector: "",
    styleLine: 0,
    classFile: owner.dataset.niaClassFile || undefined,
    classLine: Number.isFinite(classLine) && classLine > 0 ? classLine : undefined,
    classColumn: Number.isFinite(classColumn) && classColumn > 0 ? classColumn : undefined,
    classValue: owner.dataset.niaClassValue || undefined,
  };
}

function sourceFileForSheet(sheet: CSSStyleSheet): string {
  const owner = sheet.ownerNode instanceof HTMLElement ? sheet.ownerNode : null;
  const viteId = owner?.getAttribute("data-vite-dev-id") || "";
  const normalize = (value: string) => decodeURIComponent(value).replace(/\\/g, "/").split("?")[0];

  if (viteId) {
    const normalized = normalize(viteId);
    const sampleMarker = "/sample/src/";
    const sampleIndex = normalized.lastIndexOf(sampleMarker);
    if (sampleIndex >= 0) return normalized.slice(sampleIndex + 1);

    const srcMarker = "/src/";
    const srcIndex = normalized.lastIndexOf(srcMarker);
    if (srcIndex >= 0) return `sample${normalized.slice(srcIndex)}`;
  }

  if (!sheet.href) return "";

  try {
    const url = new URL(sheet.href, location.href);
    if (url.origin !== location.origin) return "";
    const pathname = normalize(url.pathname).replace(/^\/+/, "");
    if (!pathname) return "";
    if (pathname.startsWith("sample/")) return pathname;
    return pathname.startsWith("src/") ? `sample/${pathname}` : pathname;
  } catch {
    return "";
  }
}

function selectorSpecificity(selector: string): Specificity {
  const ids = selector.match(/#[a-zA-Z0-9_-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[a-zA-Z0-9_-]+|\[[^\]]+\]|:(?!:)[a-zA-Z0-9_-]+(?:\([^)]*\))?/g)?.length ?? 0;
  const cleaned = selector
    .replace(/#[a-zA-Z0-9_-]+/g, " ")
    .replace(/\.[a-zA-Z0-9_-]+/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/::?[a-zA-Z0-9_-]+(?:\([^)]*\))?/g, " ");
  const types = cleaned.match(/(^|[\s>+~])([a-zA-Z][a-zA-Z0-9-]*)/g)?.length ?? 0;
  return [ids, classes, types];
}

function compareSpecificity(a: Specificity, b: Specificity) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function isBetterCandidate(next: StyleCandidate, current: StyleCandidate | undefined) {
  if (!current) return true;
  if (next.important !== current.important) return next.important;
  const specificity = compareSpecificity(next.specificity, current.specificity);
  if (specificity !== 0) return specificity > 0;
  return next.order >= current.order;
}

function matchingSelector(selectorText: string, el: Element): string | null {
  let best: { selector: string; specificity: Specificity } | null = null;

  for (const selector of selectorText.split(",").map((part) => part.trim()).filter(Boolean)) {
    try {
      if (!el.matches(selector)) continue;
    } catch {
      continue;
    }

    const specificity = selectorSpecificity(selector);
    if (!best || compareSpecificity(specificity, best.specificity) > 0) {
      best = { selector, specificity };
    }
  }

  return best?.selector ?? null;
}

function styleTargetsFor(el: Element): Record<string, CanvasStyleTarget> {
  const candidates: Partial<Record<(typeof EDITABLE_STYLE_PROPS)[number], StyleCandidate>> = {};
  let order = 0;

  const visitRules = (rules: CSSRuleList, file: string) => {
    for (const cssRule of Array.from(rules)) {
      order += 1;

      if (cssRule instanceof CSSStyleRule) {
        const selector = matchingSelector(cssRule.selectorText, el);
        if (!selector) continue;
        const specificity = selectorSpecificity(selector);

        for (const property of EDITABLE_STYLE_PROPS) {
          const value = cssRule.style.getPropertyValue(property).trim();
          if (!value) continue;

          const candidate: StyleCandidate = {
            file,
            selector,
            property,
            value,
            important: cssRule.style.getPropertyPriority(property) === "important",
            classToken: classTokenForSelector(selector, el),
            specificity,
            order,
          };

          if (isBetterCandidate(candidate, candidates[property])) {
            candidates[property] = candidate;
          }
        }
        continue;
      }

      const nested = (cssRule as CSSGroupingRule).cssRules;
      if (nested) visitRules(nested, file);
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    const file = sourceFileForSheet(sheet as CSSStyleSheet);
    if (!file) continue;

    try {
      visitRules((sheet as CSSStyleSheet).cssRules, file);
    } catch {
      continue;
    }
  }

  const targets: Record<string, CanvasStyleTarget> = {};
  for (const property of EDITABLE_STYLE_PROPS) {
    const candidate = candidates[property];
    if (!candidate) continue;
    targets[property] = {
      file: candidate.file,
      selector: candidate.selector,
      property: candidate.property,
      value: candidate.value,
      important: candidate.important,
      classToken: candidate.classToken,
    };
  }
  return targets;
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
    styleTargets: styleTargetsFor(el),
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

let mode: CanvasMode = "inspect";
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
  if (!highlighted || mode !== "inspect") return;
  const rect = highlighted.getBoundingClientRect();
  const target = ensureOverlay();
  target.style.display = "block";
  target.style.left = `${rect.left}px`;
  target.style.top = `${rect.top}px`;
  target.style.width = `${rect.width}px`;
  target.style.height = `${rect.height}px`;
}

function setMode(nextMode: CanvasMode) {
  mode = nextMode;
  document.documentElement.dataset.niaCanvasMode = nextMode;
  if (nextMode === "inspect") {
    positionOverlay();
  } else if (overlay) {
    overlay.style.display = "none";
  }
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
  setMode("inspect");

  window.parent.postMessage(
    { source: "nia-canvas", kind: "nia:ready", url: location.href },
    NIA_SHELL_ORIGIN,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (mode !== "inspect") return;
      const el = event.target instanceof Element ? event.target : null;
      if (!el || el === overlay) return;
      highlight(el);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode !== "inspect") return;
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
      mode?: CanvasMode;
    };
    if (data?.source !== "nia-shell") return;

    if (data.kind === "nia:mode") {
      setMode(data.mode === "interact" ? "interact" : "inspect");
      return;
    }

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
