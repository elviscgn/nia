import { invoke } from "@tauri-apps/api/core";
import type { CanvasSelection } from "./canvas";

export type ScratchDocument = {
  html: string;
  css: string;
  js: string;
};

export type ScratchSelection = {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  styles: Record<string, string>;
};

export type ScratchSnapshot = {
  document: ScratchDocument;
  selection: ScratchSelection | null;
  undoDepth: number;
  version: number;
};

export type ScratchStylePatchResult = {
  file: string;
  selector: string;
  property: string;
  previousValue: string | null;
  value: string;
  undoDepth: number;
  document: ScratchDocument;
  version: number;
};

export const scratchGet = () => invoke<ScratchSnapshot>("scratch_get");
export const scratchUndo = () => invoke<ScratchSnapshot>("scratch_undo");
export const scratchReset = () => invoke<ScratchSnapshot>("scratch_reset");

export const scratchSetStylePx = (
  selector: string,
  property: string,
  valuePx: number,
) => invoke<ScratchStylePatchResult>("scratch_set_style_px", { selector, property, valuePx });

export const scratchReportSelection = (selection: CanvasSelection) =>
  invoke<void>("scratch_report_selection", {
    selection: {
      selector: selection.selector,
      tag: selection.tag,
      id: selection.id,
      classes: selection.classes,
      text: selection.text,
      styles: selection.styles,
    } satisfies ScratchSelection,
  });

const SCRATCH_BRIDGE = String.raw`(() => {
  const STYLE_PROPS = ["display","position","color","backgroundColor","fontSize","fontWeight","lineHeight","textAlign","margin","padding","border","borderRadius","flexDirection","alignItems","justifyContent","gap"];
  const EDITABLE = ["font-size","gap","border-radius","padding","margin-top","margin-bottom"];
  let mode = "inspect";
  let highlighted = null;
  let overlay = null;
  let preview = null;

  const esc = (value) => window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const part = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + esc(el.id);
    const classes = Array.from(el.classList).map((name) => "." + esc(name)).join("");
    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((node) => node.tagName === el.tagName) : [];
    const nth = siblings.length > 1 ? ":nth-of-type(" + (siblings.indexOf(el) + 1) + ")" : "";
    return tag + classes + nth;
  };
  const selectorFor = (el) => {
    const path = [];
    let node = el;
    while (node && node.nodeType === 1) {
      path.unshift(part(node));
      node = node.parentElement;
    }
    return path.join(" > ");
  };
  const styleTargetsFor = (el) => {
    const found = {};
    const visit = (rules) => {
      for (const rule of Array.from(rules || [])) {
        if (rule.type === CSSRule.STYLE_RULE) {
          let matches = false;
          try { matches = el.matches(rule.selectorText); } catch {}
          if (!matches) continue;
          for (const property of EDITABLE) {
            const value = rule.style.getPropertyValue(property).trim();
            if (!value) continue;
            found[property] = {
              file: "scratch/styles.css",
              selector: rule.selectorText,
              property,
              value,
              important: rule.style.getPropertyPriority(property) === "important"
            };
          }
        } else if (rule.cssRules) {
          visit(rule.cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try { visit(sheet.cssRules); } catch {}
    }
    return found;
  };
  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    const styles = {};
    const computed = getComputedStyle(el);
    for (const prop of STYLE_PROPS) {
      const cssName = prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      const value = computed.getPropertyValue(cssName);
      if (value) styles[prop] = value.trim();
    }
    const path = [];
    let node = el;
    while (node && node.nodeType === 1) {
      path.unshift(part(node));
      node = node.parentElement;
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      path,
      selector: selectorFor(el),
      styles,
      styleTargets: styleTargetsFor(el),
      text: (el.innerText || el.textContent || "").trim().slice(0, 140),
      sourceUrl: "scratch://index.html",
      source: {
        file: "scratch/index.html",
        line: 1,
        column: 1,
        styleFile: "scratch/styles.css",
        styleSelector: "",
        styleLine: 1
      }
    };
  };
  const post = (el) => parent.postMessage({ source: "nia-canvas", kind: "nia:select", selection: describe(el) }, "*");
  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    Object.assign(overlay.style, { position:"fixed", pointerEvents:"none", zIndex:"2147483647", border:"2px solid #d7a11c", boxSizing:"border-box" });
    document.documentElement.appendChild(overlay);
    return overlay;
  };
  const position = () => {
    if (!highlighted || mode !== "inspect") return;
    const rect = highlighted.getBoundingClientRect();
    const box = ensureOverlay();
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
  };
  const highlight = (el) => { highlighted = el; position(); };
  const inspect = (selector) => {
    const el = document.querySelector(selector || "body");
    if (!el) return;
    highlight(el);
    post(el);
  };
  document.addEventListener("pointermove", (event) => {
    if (mode !== "inspect") return;
    const el = event.target instanceof Element ? event.target : null;
    if (!el || el === overlay) return;
    highlight(el);
  }, true);
  document.addEventListener("click", (event) => {
    if (mode !== "inspect") return;
    event.preventDefault();
    event.stopPropagation();
    const el = event.target instanceof Element ? event.target : document.body;
    if (el === overlay) return;
    highlight(el);
    post(el);
  }, true);
  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source !== "nia-shell") return;
    if (data.kind === "nia:mode") {
      mode = data.mode === "interact" ? "interact" : "inspect";
      if (mode !== "inspect" && overlay) overlay.style.display = "none";
      if (mode === "inspect") position();
      return;
    }
    if (data.kind === "nia:inspect-request") return inspect(data.selector || "body");
    if (data.kind === "nia:style-preview") {
      if (!preview) {
        preview = document.createElement("style");
        document.head.appendChild(preview);
      }
      preview.textContent = data.selector + " { " + data.property + ": " + data.value + " !important; }";
      requestAnimationFrame(() => inspect(data.inspectSelector || data.selector || "body"));
      return;
    }
    if (data.kind === "nia:style-preview-clear" && preview) preview.textContent = "";
  });
  window.addEventListener("resize", position);
  parent.postMessage({ source: "nia-canvas", kind: "nia:ready", url: "scratch://index.html" }, "*");
})();`;

export function buildScratchPreview(document: ScratchDocument | null) {
  if (!document) return "";
  const css = document.css.replace(/<\/style/gi, "<\\/style");
  const js = document.js.replace(/<\/script/gi, "<\\/script");
  const bridge = SCRATCH_BRIDGE.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
</head>
<body>
${document.html}
<script>window.addEventListener("error", (event) => parent.postMessage({ source: "nia-scratch", kind: "error", message: event.message }, "*"));\n${js}</script>
<script>${bridge}</script>
</body>
</html>`;
}
