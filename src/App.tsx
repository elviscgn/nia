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
  type CanvasSelection,
  type CanvasStatus,
  type CanvasStylePatchResult,
  type StyleIndexState,
} from "./lib/canvas";

export default function App() {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [canvas, setCanvas] = useState<CanvasStatus | null>(null);
  const [styleIndex, setStyleIndex] = useState<StyleIndexState | null>(null);
  const [cdp, setCdp] = useState<string>("cdp: ...");
  const [lastPatch, setLastPatch] = useState<CanvasStylePatchResult | null>(null);
  const [lastPatchMs, setLastPatchMs] = useState<number | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoInspected = useRef(false);

  useEffect(() => { coreHealth().then(setHealth).catch(() => {}); }, []);
  useEffect(() => { canvasStatus().then(setCanvas).catch(() => {}); }, []);
  useEffect(() => { canvasHistoryState().then((state) => setUndoDepth(state.undoDepth)).catch(() => {}); }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      canvasStyleIndexState()
        .then((state) => { if (active) setStyleIndex(state); })
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
      .then((v) => setCdp(`cdp: ok ${JSON.stringify(v)}`))
      .catch((e) => setCdp(`cdp: error ${String(e)}`));
  }, []);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const msg = parseCanvasMessage(event);
      if (!msg) return;
      if (msg.kind === "nia:ready") {
        setCanvas((current) => (current ? { ...current, reachable: true } : current));
        if (!autoInspected.current) {
          autoInspected.current = true;
          requestCanvasInspect(iframeRef.current, "#hero-title");
        }
      } else {
        try {
          setSelection(await canvasReportSelection(msg.selection));
        } catch {
          setSelection(msg.selection);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function benchmark() {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) samples.push(await coreRoundTrip());
    setLatency(samples.reduce((a, b) => a + b, 0) / samples.length);
  }

  async function changeNumericStyle(property: string, computedKey: string, delta: number) {
    if (!selection?.source?.styleFile || !selection.source.styleSelector) return;
    const current = Number.parseFloat(selection.styles[computedKey] ?? "");
    if (!Number.isFinite(current)) return;

    const next = Math.max(0, current + delta);
    const nextValue = `${next}px`;

    previewCanvasStyle(
      iframeRef.current,
      selection.source.styleSelector,
      property,
      nextValue,
      selection.selector,
    );

    const started = performance.now();
    try {
      const patch = await canvasSetStylePx(
        selection.source.styleFile,
        selection.source.styleSelector,
        property,
        next,
      );
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

  const hasNumericStyle = (key: string) =>
    Number.isFinite(Number.parseFloat(selection?.styles[key] ?? ""));

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

      <section className="center">
        <div className="canvasToolbar"><span>↖ &nbsp; ✋</span><span>Desktop · 1440 × 900</span><span>Fit &nbsp; 100%</span></div>
        <div className="canvas">
          <div className="browser"><div className="browserBar"><span>● ● ●</span><div>{CANVAS_ORIGIN}</div><span className="pill">{canvas ? (canvas.reachable ? "canvas: live" : "canvas: down") : "canvas: ..."}</span><button onClick={() => { if (iframeRef.current) iframeRef.current.src = CANVAS_ORIGIN; }}>Reload</button></div>
            <iframe ref={iframeRef} className="canvasFrame" title="Nia canvas" src={CANVAS_ORIGIN} />
          </div>
        </div>
        <div className="terminal"><div className="terminalTabs">Terminal &nbsp;&nbsp; Problems &nbsp;&nbsp; Console &nbsp;&nbsp; Network &nbsp;&nbsp; Tests</div><pre>{cdp}{"\n"}nia › dev server ready · CEF canvas online</pre></div>
      </section>

      <aside className="inspector"><div className="tabs"><b>Inspect</b><span>Components</span><span>Page</span></div>
        {selection ? <div className="selectionLive">
          <small>SELECTED · VIA RUST</small>
          <strong>{selection.tag}{selection.id ? `#${selection.id}` : ""}{selection.classes.map((c) => `.${c}`).join("")}</strong>
          {selection.source ? <div className="sourceRef">
            <b>Source</b>
            <code>{selection.source.file}:{selection.source.line}:{selection.source.column}</code>
            <span>{selection.source.styleSelector} · {selection.source.styleFile}{selection.source.styleLine ? `:${selection.source.styleLine}` : ""}</span>
            <div className="sourceActions">
              <button disabled={!hasNumericStyle("fontSize")} onClick={() => changeNumericStyle("font-size", "fontSize", -4)}>Font -4</button>
              <button disabled={!hasNumericStyle("fontSize")} onClick={() => changeNumericStyle("font-size", "fontSize", 4)}>Font +4</button>
              <button disabled={!hasNumericStyle("gap")} onClick={() => changeNumericStyle("gap", "gap", -4)}>Gap -4</button>
              <button disabled={!hasNumericStyle("gap")} onClick={() => changeNumericStyle("gap", "gap", 4)}>Gap +4</button>
              <button disabled={!hasNumericStyle("borderRadius")} onClick={() => changeNumericStyle("border-radius", "borderRadius", -4)}>Radius -4</button>
              <button disabled={!hasNumericStyle("borderRadius")} onClick={() => changeNumericStyle("border-radius", "borderRadius", 4)}>Radius +4</button>
              <button disabled={undoDepth === 0} onClick={undoLastStyleEdit}>Undo {undoDepth ? `(${undoDepth})` : ""}</button>
            </div>
            {lastPatch ? <small className="patchStatus">wrote {lastPatch.property}: {lastPatch.value}{lastPatchMs === null ? "" : ` · ${lastPatchMs.toFixed(1)} ms`}</small> : null}
          </div> : <div className="sourceRef"><b>Source</b><span>No source metadata yet</span></div>}
          <div className="kv"><span>box</span><span>{selection.rect.x}, {selection.rect.y} · {selection.rect.width} × {selection.rect.height}</span></div>
          <div className="kv"><span>text</span><span>{selection.text || "-"}</span></div>
          <section><b>DOM path</b><ol>{selection.path.map((part, index) => <li key={`${part}-${index}`}>{part}</li>)}</ol></section>
          <section><b>Computed</b>{Object.entries(selection.styles).map(([key, value]) => <p key={key}>{key} &nbsp; {value}</p>)}</section>
        </div> : <div className="selection"><small>SELECTED</small><strong>Nothing yet</strong><span>Click an element in the canvas...</span></div>}
        <div className="perf">
          <div><span>Rust IPC</span><strong>{latency === null ? "-" : `${latency.toFixed(2)} ms`}</strong></div>
          <div><span>CSS index</span><strong>{styleIndex ? `v${styleIndex.version} · ${styleIndex.ruleCount} rules` : "..."}</strong></div>
          <button onClick={benchmark}>Benchmark ×20</button>
        </div>
      </aside>
    </section>
  </main>;
}
