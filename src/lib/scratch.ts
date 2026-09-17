export type ScratchDocument = {
  html: string;
  css: string;
  js: string;
};

const STORAGE_KEY = "nia:scratch:v2";

export const STARTER_SCRATCH: ScratchDocument = {
  html: `<main class="landing">
  <p class="eyebrow">Nia Scratch</p>
  <h1>Build the idea first.</h1>
  <p class="lede">Raw HTML, CSS, and JavaScript. No framework in the way.</p>
  <button id="action">Try it</button>
  <p id="status" class="status">Ready.</p>
</main>`,
  css: `* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #191813;
  background: #f5f2e9;
}
.landing { width: min(680px, calc(100vw - 48px)); }
.eyebrow { color: #9a6a00; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 12px 0; font-size: 72px; line-height: .94; letter-spacing: -.05em; }
.lede { max-width: 520px; color: #69655c; font-size: 18px; line-height: 1.6; }
button { margin-top: 20px; border: 0; border-radius: 10px; padding: 12px 18px; font: inherit; font-weight: 700; background: #d79a08; color: #1d1708; cursor: pointer; }
.status { margin-top: 18px; color: #7d776d; }`,
  js: `const button = document.querySelector("#action");
const status = document.querySelector("#status");
let clicks = 0;
button?.addEventListener("click", () => {
  clicks += 1;
  if (status) status.textContent = \`Clicked \${clicks} time\${clicks === 1 ? "" : "s"}.\`;
});`,
};

export function loadScratchDocument(): ScratchDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return STARTER_SCRATCH;
    const parsed = JSON.parse(raw) as Partial<ScratchDocument>;
    return {
      html: typeof parsed.html === "string" ? parsed.html : STARTER_SCRATCH.html,
      css: typeof parsed.css === "string" ? parsed.css : STARTER_SCRATCH.css,
      js: typeof parsed.js === "string" ? parsed.js : STARTER_SCRATCH.js,
    };
  } catch {
    return STARTER_SCRATCH;
  }
}

export function saveScratchDocument(document: ScratchDocument) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

export function patchScratchCss(
  css: string,
  selector: string,
  property: string,
  value: string,
) {
  const marker = "/* nia:visual-edits */";
  const safeSelector = selector.trim();
  if (!safeSelector) return css;
  const nextRule = `${safeSelector} { ${property}: ${value} !important; }`;
  const block = `${marker}\n${nextRule}`;
  const markerIndex = css.indexOf(marker);
  if (markerIndex < 0) return `${css.trimEnd()}\n\n${block}\n`;

  const before = css.slice(0, markerIndex).trimEnd();
  const existing = css.slice(markerIndex + marker.length).trim();
  const lines = existing.split("\n").filter(Boolean);
  const prefix = `${safeSelector} { ${property}:`;
  let replaced = false;
  const updated = lines.map((line) => {
    if (!replaced && line.trim().startsWith(prefix)) {
      replaced = true;
      return nextRule;
    }
    return line;
  });
  if (!replaced) updated.push(nextRule);
  return `${before}\n\n${marker}\n${updated.join("\n")}\n`;
}

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

export function buildScratchPreview(document: ScratchDocument) {
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
