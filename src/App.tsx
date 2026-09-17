import { useEffect, useRef, useState } from "react";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";
import {
  CANVAS_ORIGIN,
  canvasCdpEvaluate,
  canvasHistoryState,
  canvasReportSelection,
  canvasSetStylePx,
  canvasStatus,
  canvasStyleIndexState,
  canvasUndoStyle,
  clearCanvasStylePreview,
  parseCanvasMessage,
  previewCanvasStyle,
  requestCanvasInspect,
  setCanvasMode as postCanvasMode,
  type CanvasMode,
  type CanvasSelection,
  type CanvasStatus,
  type CanvasStylePatchResult,
  type StyleIndexState,
} from "./lib/canvas";

const EDITABLE_PROPERTIES = [
  { property: "font-size", key: "fontSize", label: "Font size", step: 4 },
  { property: "gap", key: "gap", label: "Gap", step: 4 },
  { property: "border-radius", key: "borderRadius", label: "Radius", step: 4 },
] as const;

export default function App() {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [canvas, setCanvas] = useState<CanvasStatus | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("inspect");
  const [styleIndex, setStyleIndex] = useState<StyleIndexState | null>(null);
  const [cdp, setCdp] = useState<string>("cdp: ...");
  const [lastPatch, setLastPatch] = useState<CanvasStylePatchResult | null>(null);
  const [lastPatchMs, setLastPatchMs] = useState<number | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const selectionRef = useRef<CanvasSelection | null>(null);
  const autoInspected = useRef(false);

  useEffect(() => { coreHealth().then(setHealth).catch(() => {}); }, []);
  useEffect(() => { canvasStatus().then(setCanvas).catch(() => {}); }, []);
  useEffect(() => { canvasHistoryState().then((state) => setUndoDepth(state.undoDepth)).catch(() => {}); }, []);
  useEffect(() => { postCanvasMode(iframeRef.current, canvasMode); }, [canvasMode]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      canvasStyleIndexState()
        .then((state) => {
          if (!active) return;
          setStyleIndex((previous) => {
            if (previous && previous.version !== state.version && selectionRef.current) {
              requestCanvasInspect(iframeRef.current, selectionRef.current.selector);
            }
            return state;
          });
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    canvasCdpEvaluate("({title: document.title, url: location.href})")
      .then((value) => setCdp(`cdp: ok ${JSON.stringify(value)}`))
      .catch((error) => setCdp(`cdp: error ${String(error)}`));
  }, []);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const msg = parseCanvasMessage(event);
      if (!msg) return;
      if (msg.kind === "nia:ready") {
        setCanvas((current) => current ? { ...current, reachable: true } : current);
        postCanvasMode(iframeRef.current, "inspect");
        if (!autoInspected.current) {
          autoInspected.current = true;
          requestCanvasInspect(iframeRef.current, "#hero-title");
        }
        return;
      }

      try {
        const resolved = await canvasReportSelection(msg.selection);
        const browserSource = msg.selection.source;
        const nextSelection: CanvasSelection = {
          ...resolved,
          source: resolved.source ? {
            ...resolved.source,
            classFile: browserSource?.classFile,
            classLine: browserSource?.classLine,
            classColumn: browserSource?.classColumn,
            classValue: browserSource?.classValue,
          } : resolved.source,
          styleTargets: msg.selection.styleTargets ?? {},
        };
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
      } catch {
        selectionRef.current = msg.selection;
        setSelection(msg.selection);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function benchmark() {
    const samples: number[] = [];
    for (let index = 0; index < 20; index++) samples.push(await coreRoundTrip());
    setLatency(samples.reduce((a, b) => a + b, 0) / samples.length);
  }

  async function changeNumericStyle(property: string, computedKey: string, delta: number) {
    if (!selection) return;
    const current = Number.parseFloat(selection.styles[computedKey] ?? "");
    if (!Number.isFinite(current)) return;

    const exactTarget = selection.styleTargets?.[property];
    const file = exactTarget?.file || selection.source?.styleFile || "";
    const selector = exactTarget?.selector || selection.source?.styleSelector || "";
    if (!file || !selector) return;

    const next = Math.max(0, current + delta);
    previewCanvasStyle(iframeRef.current, selector, property, `${next}px`, selection.selector);

    const started = performance.now();
    try {
      const patch = await canvasSetStylePx(file, selector, property, next);
      setLastPatch(patch);
      setLastPatchMs(performance.now() - started);
      setUndoDepth(patch.undoDepth);
      window.setTimeout(() => {
        clearCanvasStylePreview(iframeRef.current);
        requestCanvasInspect(iframeRef.current, selection.selector);
      }, 400);
    } catch (error) {
      clearCanvasStylePreview(iframeRef.current);
      requestCanvasInspect(iframeRef.current, selection.selector);
      throw error;
    }
  }

  async function undoLastStyleEdit() {
    const inspectSelector = selection?.selector;
    clearCanvasStylePreview(iframeRef.current);
    const result = await canvasUndoStyle();
    setUndoDepth(result.undoDepth);
    setLastPatch(null);
    setLastPatchMs(null);
    if (inspectSelector) {
      window.setTimeout(() => requestCanvasInspect(iframeRef.current, inspectSelector), 250);
    }
  }

  function switchCanvasMode(nextMode: CanvasMode) {
    setCanvasMode(nextMode);
    postCanvasMode(iframeRef.current, nextMode);
  }

  const selectedName = selection
    ? `${selection.tag}${selection.id ? `#${selection.id}` : ""}${selection.classes.map((item) => `.${item}`).join("")}`
    : "Nothing selected";

  const sourceLabel = selection?.source
    ? `${selection.source.file}:${selection.source.line}:${selection.source.column}`
    : "No source metadata";

  return <main className="app">
    <header className="topbar">
      <div className="brand"><div className="mark"><i/><i/></div><strong>Nia</strong><button>website⌄</button><span>main</span></div>
      <nav><button className="active">Canvas</button><button>Code</button><button>Split</button><button>Scratch</button></nav>
      <div className="actions"><span>{health ? "CEF + Rust" : "connecting..."}</span><button>Model · Auto</button><button className="run">Run</button></div>
    </header>

    <section className="workspace">
      <aside className="rail"><div className="railActive">A</div><div>V</div><div>F</div><div>Δ</div><div>⌕</div></aside>

      <aside className="agent">
        <div className="panelTitle">Nia Agent <span>•••</span></div>
        <div className="vision"><b>VISION CONTEXT</b><p>Warm editorial interface. Restrained amber. Dense typography. Minimal decoration.</p><small>Project vision · 3 refs</small></div>
        <div className="chat"><div className="user">Make the hero feel more focused without making it sterile.</div><p><b>Nia</b><br/>I’ll preserve hierarchy and reduce noise around the primary action.</p></div>
        <div className="composer"><div className="chips"><span>HeroHeading ×</span><span>Vision ×</span></div><textarea placeholder="Ask Nia..."/><div className="sendRow"><span>Fast</span><button>↑</button></div></div>
      </aside>

      <section className={`center ${terminalOpen ? "terminalOpen" : "terminalClosed"}`}>
        <div className="canvasToolbar">
          <span className="modeSwitch">
            <button className={canvasMode === "inspect" ? "active" : ""} onClick={() => switchCanvasMode("inspect")}>Inspect</button>
            <button className={canvasMode === "interact" ? "active" : ""} onClick={() => switchCanvasMode("interact")}>Interact</button>
          </span>
          <span>Desktop · 1440 × 900</span>
          <span>Fit &nbsp; 100%</span>
        </div>

        <div className="canvas">
          <div className="browser">
            <div className="browserBar"><span>● ● ●</span><div>{CANVAS_ORIGIN}</div><span className="pill">{canvas ? (canvas.reachable ? "live" : "down") : "..."}</span><button onClick={() => { if (iframeRef.current) iframeRef.current.src = CANVAS_ORIGIN; }}>Reload</button></div>
            <iframe ref={iframeRef} className="canvasFrame" title="Nia canvas" src={CANVAS_ORIGIN} />
          </div>
        </div>

        <div className="terminal">
          <button className="terminalTabs" onClick={() => setTerminalOpen((open) => !open)}>
            <span>Terminal</span><span>Problems</span><span>Console</span><span>Network</span><span>Tests</span><b>{terminalOpen ? "⌄" : "⌃"}</b>
          </button>
          {terminalOpen ? <pre>{cdp}{"\n"}nia › dev server ready · CEF canvas online</pre> : null}
        </div>
      </section>

      <aside className="inspector">
        <div className="tabs"><b>Inspect</b><span>Components</span><span>Page</span></div>
        {selection ? <div className="selectionLive">
          <div className="selectionHeader">
            <div><small>SELECTED</small><strong>{selectedName}</strong></div>
            <button disabled={undoDepth === 0} onClick={undoLastStyleEdit}>Undo{undoDepth ? ` ${undoDepth}` : ""}</button>
          </div>

          <section className="inspectorBlock sourceBlock">
            <div className="sectionTitle"><b>Source</b><code>{sourceLabel}</code></div>
            {selection.source?.classValue ? <div className="sourceMeta"><span>className</span><code>"{selection.source.classValue}"</code></div> : null}
            {selection.source?.styleFile ? <div className="sourceMeta"><span>style</span><code>{selection.source.styleSelector} · {selection.source.styleFile}{selection.source.styleLine ? `:${selection.source.styleLine}` : ""}</code></div> : null}
          </section>

          <section className="inspectorBlock">
            <div className="sectionTitle"><b>Properties</b><span>{selection.rect.width} × {selection.rect.height}</span></div>
            <div className="propertyRows">
              {EDITABLE_PROPERTIES.map(({ property, key, label, step }) => {
                const numericValue = Number.parseFloat(selection.styles[key] ?? "");
                const available = Number.isFinite(numericValue);
                const owner = selection.styleTargets?.[property];
                return <div className="propertyRow" key={property}>
                  <div className="propertyIdentity"><span>{label}</span>{owner ? <small>{owner.classToken ? `class ${owner.classToken}` : owner.selector}</small> : <small>computed</small>}</div>
                  <div className="stepper"><button disabled={!available} onClick={() => changeNumericStyle(property, key, -step)}>−</button><code>{available ? `${numericValue}px` : "auto"}</code><button disabled={!available} onClick={() => changeNumericStyle(property, key, step)}>+</button></div>
                </div>;
              })}
            </div>
            {lastPatch ? <div className="patchStatus">Saved {lastPatch.property} {lastPatch.value}{lastPatchMs === null ? "" : ` · ${lastPatchMs.toFixed(1)} ms`}</div> : null}
          </section>

          <section className="inspectorBlock compactBlock">
            <div className="sectionTitle"><b>Element</b></div>
            <div className="metaGrid"><span>Position</span><code>{selection.rect.x}, {selection.rect.y}</code><span>Text</span><code>{selection.text || "-"}</code></div>
          </section>

          <details className="debugDetails">
            <summary>DOM path</summary>
            <ol>{selection.path.map((part, index) => <li key={`${part}-${index}`}>{part}</li>)}</ol>
          </details>

          <details className="debugDetails">
            <summary>Computed styles</summary>
            <div className="computedGrid">{Object.entries(selection.styles).map(([key, value]) => <><span key={`${key}-k`}>{key}</span><code key={`${key}-v`}>{value}</code></>)}</div>
          </details>
        </div> : <div className="emptyInspector"><span>Inspect mode</span><strong>Click anything on the canvas</strong><p>Nia will resolve the DOM node, JSX source, and editable style owner.</p></div>}

        <div className="perf">
          <div><span>Rust IPC</span><strong>{latency === null ? "-" : `${latency.toFixed(2)} ms`}</strong></div>
          <div><span>CSS index</span><strong>{styleIndex ? `v${styleIndex.version} · ${styleIndex.ruleCount}` : "..."}</strong></div>
          <button onClick={benchmark}>Benchmark ×20</button>
        </div>
      </aside>
    </section>
  </main>;
}
