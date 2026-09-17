import { useEffect, useMemo, useState } from "react";
import "./scratch.css";

type ScratchTab = "html" | "css" | "js";

type ScratchDocument = {
  html: string;
  css: string;
  js: string;
};

type ScratchWorkspaceProps = {
  onClose: () => void;
};

const STORAGE_KEY = "nia:scratch:v1";

const STARTER: ScratchDocument = {
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
h1 { margin: 12px 0; font-size: clamp(48px, 8vw, 88px); line-height: .94; letter-spacing: -.05em; }
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

function loadScratch(): ScratchDocument {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return STARTER;
    const parsed = JSON.parse(value) as Partial<ScratchDocument>;
    return {
      html: typeof parsed.html === "string" ? parsed.html : STARTER.html,
      css: typeof parsed.css === "string" ? parsed.css : STARTER.css,
      js: typeof parsed.js === "string" ? parsed.js : STARTER.js,
    };
  } catch {
    return STARTER;
  }
}

function buildPreview(document: ScratchDocument) {
  const safeJs = document.js.replace(/<\/script/gi, "<\\/script");
  const style = `<style>\n${document.css}\n</style>`;
  const script = `<script>\nwindow.addEventListener("error", (event) => {\n  parent.postMessage({ source: "nia-scratch", kind: "error", message: event.message }, "*");\n});\n${safeJs}\n<\/script>`;
  const html = document.html.trim();

  if (/<!doctype|<html[\s>]/i.test(html)) {
    let output = html;
    output = /<\/head>/i.test(output)
      ? output.replace(/<\/head>/i, `${style}\n</head>`)
      : `${style}\n${output}`;
    output = /<\/body>/i.test(output)
      ? output.replace(/<\/body>/i, `${script}\n</body>`)
      : `${output}\n${script}`;
    return output;
  }

  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${style}\n</head>\n<body>\n${html}\n${script}\n</body>\n</html>`;
}

export default function ScratchWorkspace({ onClose }: ScratchWorkspaceProps) {
  const [document, setDocument] = useState<ScratchDocument>(() => loadScratch());
  const [previewDocument, setPreviewDocument] = useState<ScratchDocument>(document);
  const [tab, setTab] = useState<ScratchTab>("html");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
      setPreviewDocument(document);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; kind?: string; message?: string };
      if (data?.source !== "nia-scratch" || data.kind !== "error") return;
      setRuntimeError(data.message || "Scratch runtime error");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const srcDoc = useMemo(() => buildPreview(previewDocument), [previewDocument]);
  const value = document[tab];

  const updateActive = (next: string) => {
    setRuntimeError(null);
    setDocument((current) => ({ ...current, [tab]: next }));
  };

  const reset = () => {
    setDocument(STARTER);
    setPreviewDocument(STARTER);
    setRuntimeError(null);
  };

  return (
    <section className="scratchWorkspace" aria-label="Scratch workspace">
      <header className="scratchTopbar">
        <div>
          <strong>Scratch</strong>
          <span>Raw HTML + CSS + JS</span>
        </div>
        <div className="scratchActions">
          <span className="scratchLive">Live</span>
          <button onClick={reset}>Reset</button>
          <button className="scratchClose" onClick={onClose}>Back to Canvas</button>
        </div>
      </header>

      <div className="scratchBody">
        <section className="scratchEditorPane">
          <nav className="scratchTabs" aria-label="Scratch files">
            {(["html", "css", "js"] as ScratchTab[]).map((name) => (
              <button
                key={name}
                className={tab === name ? "active" : ""}
                onClick={() => setTab(name)}
              >
                {name === "html" ? "index.html" : name === "css" ? "styles.css" : "script.js"}
              </button>
            ))}
          </nav>
          <textarea
            className="scratchEditor"
            value={value}
            onChange={(event) => updateActive(event.target.value)}
            spellCheck={false}
            aria-label={`${tab} editor`}
          />
          <footer className="scratchEditorStatus">
            <span>{value.length.toLocaleString()} chars</span>
            <span>autosaved locally</span>
          </footer>
        </section>

        <section className="scratchPreviewPane">
          <div className="scratchPreviewBar">
            <span>Preview</span>
            <span>{runtimeError ? `JS error: ${runtimeError}` : "live reload"}</span>
          </div>
          <iframe
            title="Scratch preview"
            className="scratchPreview"
            sandbox="allow-scripts allow-forms allow-modals"
            srcDoc={srcDoc}
          />
        </section>
      </div>
    </section>
  );
}
