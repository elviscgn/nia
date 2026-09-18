import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ScratchCodePanel from "./ScratchCodePanel";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";
import {
  clearCanvasStylePreview,
  parseCanvasMessage,
  previewCanvasStyle,
  requestCanvasInspect,
  setCanvasMode as postCanvasMode,
  type CanvasMode,
  type CanvasSelection,
} from "./lib/canvas";
import {
  buildScratchPreview,
  scratchGet,
  scratchReportSelection,
  scratchReset,
  scratchSetStylePx,
  scratchUndo,
  type ScratchDocument,
  type ScratchSnapshot,
  type ScratchStylePatchResult,
} from "./lib/scratch";

type AppProps = {
  agentPanel: ReactNode;
  modelLabel: string;
  onOpenModelSettings: () => void;
};

type WorkspaceView = "canvas" | "code" | "split";

type ScratchUpdatedDetail = {
  document: ScratchDocument;
  undoDepth: number;
  version: number;
};

export default function App({ agentPanel, modelLabel, onOpenModelSettings }: AppProps) {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("inspect");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("canvas");
  const [scratchDocument, setScratchDocument] = useState<ScratchDocument | null>(null);
  const [scratchUndoDepth, setScratchUndoDepth] = useState(0);
  const [lastPatch, setLastPatch] = useState<ScratchStylePatchResult | null>(null);
  const [lastPatchMs, setLastPatchMs] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoInspected = useRef(false);

  const scratchSrcDoc = useMemo(() => buildScratchPreview(scratchDocument), [scratchDocument]);
  const canvasVisible = workspaceView !== "code";

  useEffect(() => {
    coreHealth().then(setHealth).catch(() => {});
    scratchGet()
      .then((snapshot) => {
        setScratchDocument(snapshot.document);
        setScratchUndoDepth(snapshot.undoDepth);
      })
      .catch((error) => setEditError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!canvasVisible) return;
    postCanvasMode(iframeRef.current, canvasMode, "*");
  }, [canvasMode, scratchSrcDoc, workspaceView, canvasVisible]);

  useEffect(() => {
    const onScratchUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ScratchUpdatedDetail>).detail;
      if (!detail?.document) return;
      setScratchDocument(detail.document);
      setScratchUndoDepth(detail.undoDepth);
      setSelection(null);
      setLastPatch(null);
      setLastPatchMs(null);
      setEditError(null);
      autoInspected.current = false;
    };
    window.addEventListener("nia:scratch-updated", onScratchUpdated);
    return () => window.removeEventListener("nia:scratch-updated", onScratchUpdated);
  }, []);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const message = parseCanvasMessage(event);
      if (!message) return;

      if (message.kind === "nia:ready") {
        postCanvasMode(iframeRef.current, canvasMode, "*");
        if (!autoInspected.current) {
          autoInspected.current = true;
          requestCanvasInspect(iframeRef.current, "h1", "*");
        }
        return;
      }

      setSelection(message.selection);
      void scratchReportSelection(message.selection).catch(() => {});
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canvasMode]);

  function applyScratchSnapshot(snapshot: ScratchSnapshot) {
    setScratchDocument(snapshot.document);
    setScratchUndoDepth(snapshot.undoDepth);
    setSelection(null);
    setLastPatch(null);
    setLastPatchMs(null);
    setEditError(null);
    autoInspected.current = false;
  }

  async function benchmark() {
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      samples.push(await coreRoundTrip());
    }
    setLatency(samples.reduce((total, sample) => total + sample, 0) / samples.length);
  }

  function switchCanvasMode(nextMode: CanvasMode) {
    setCanvasMode(nextMode);
    postCanvasMode(iframeRef.current, nextMode, "*");
  }

  async function changeNumericStyle(property: string, computedKey: string, delta: number) {
    if (!selection) return;
    const current = Number.parseFloat(selection.styles[computedKey] ?? "");
    if (!Number.isFinite(current)) return;

    const exactTarget = selection.styleTargets?.[property];
    const selector = exactTarget?.selector || selection.selector;
    if (!selector) return;

    const next = Math.max(0, current + delta);
    const nextValue = `${next}px`;
    previewCanvasStyle(
      iframeRef.current,
      selector,
      property,
      nextValue,
      selection.selector,
      "*",
    );

    setEditError(null);
    const started = performance.now();
    try {
      const patch = await scratchSetStylePx(selector, property, next);
      setScratchDocument(patch.document);
      setScratchUndoDepth(patch.undoDepth);
      setLastPatch(patch);
      setLastPatchMs(performance.now() - started);
      window.setTimeout(() => {
        clearCanvasStylePreview(iframeRef.current, "*");
        requestCanvasInspect(iframeRef.current, selection.selector, "*");
      }, 180);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
      clearCanvasStylePreview(iframeRef.current, "*");
    }
  }

  async function undoLastStyleEdit() {
    if (scratchUndoDepth === 0) return;
    const inspectSelector = selection?.selector;
    setEditError(null);
    clearCanvasStylePreview(iframeRef.current, "*");

    try {
      const snapshot = await scratchUndo();
      applyScratchSnapshot(snapshot);
      if (inspectSelector && canvasVisible) {
        window.setTimeout(() => requestCanvasInspect(iframeRef.current, inspectSelector, "*"), 180);
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  }

  async function newScratch() {
    setEditError(null);
    clearCanvasStylePreview(iframeRef.current, "*");
    try {
      applyScratchSnapshot(await scratchReset());
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  }

  const hasNumericStyle = (key: string) =>
    Number.isFinite(Number.parseFloat(selection?.styles[key] ?? ""));

  const ownerLabel = (property: string) => {
    const target = selection?.styleTargets?.[property];
    if (!target) return null;
    return `${property} -> ${target.selector} · ${target.file}`;
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark"><i/><i/></div>
          <strong>Nia</strong>
          <button>scratch⌄</button>
          <span>local</span>
        </div>
        <nav>
          <button className={workspaceView === "canvas" ? "active" : ""} onClick={() => setWorkspaceView("canvas")}>Canvas</button>
          <button className={workspaceView === "code" ? "active" : ""} onClick={() => setWorkspaceView("code")}>Code</button>
          <button className={workspaceView === "split" ? "active" : ""} onClick={() => setWorkspaceView("split")}>Split</button>
        </nav>
        <div className="actions">
          <span>{health ? "CEF + Rust" : "connecting..."}</span>
          <button onClick={onOpenModelSettings}>{modelLabel}</button>
          <button className="run">Run</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="rail">
          <div className="railActive">A</div>
          <div>V</div>
          <div>F</div>
          <div>Δ</div>
          <div>⌕</div>
          <button className="railSettingsButton" onClick={onOpenModelSettings} aria-label="Open settings" title="Settings">S</button>
        </aside>

        <aside className="agent">
          <div className="panelTitle">Nia Agent <span>•••</span></div>
          {agentPanel}
        </aside>

        <section className="center">
          <div className="canvasToolbar">
            <span>
              <button disabled={!canvasVisible} className={canvasVisible && canvasMode === "inspect" ? "active" : ""} onClick={() => switchCanvasMode("inspect")}>Inspect</button>
              <button disabled={!canvasVisible} className={canvasVisible && canvasMode === "interact" ? "active" : ""} onClick={() => switchCanvasMode("interact")}>Interact</button>
            </span>
            <span>{workspaceView === "code" ? "Raw Scratch source" : "Desktop · 1440 × 900"}</span>
            <span>
              <span className="scratchModeBadge"><i>⌁</i> Scratch</span>
              <button onClick={() => void newScratch()}>New</button>
              &nbsp; Fit &nbsp; 100%
            </span>
          </div>

          <div className={`scratchSurface ${workspaceView}View`}>
            {canvasVisible ? (
              <div className="canvas">
                <div className="browser">
                  <div className="browserBar">
                    <span>● ● ●</span>
                    <div>scratch://index.html</div>
                    <span className="pill">scratch: live</span>
                    <button onClick={() => {
                      if (iframeRef.current) iframeRef.current.srcdoc = scratchSrcDoc;
                    }}>Reload</button>
                  </div>
                  <iframe
                    ref={iframeRef}
                    className="canvasFrame"
                    title="Nia Scratch canvas"
                    srcDoc={scratchSrcDoc}
                    sandbox="allow-scripts allow-forms allow-modals"
                  />
                </div>
              </div>
            ) : null}

            {workspaceView !== "canvas" ? (
              <ScratchCodePanel document={scratchDocument} onSaved={applyScratchSnapshot} />
            ) : null}
          </div>

          <div className="terminal">
            <div className="terminalTabs">Terminal &nbsp;&nbsp; Problems &nbsp;&nbsp; Console &nbsp;&nbsp; Network &nbsp;&nbsp; Tests</div>
            <pre>scratch › raw HTML/CSS/JS canvas{"\n"}nia › Rust Scratch core online · undo {scratchUndoDepth}</pre>
          </div>
        </section>

        <aside className="inspector">
          <div className="tabs"><b>Inspect</b><span>DOM</span><span>Page</span></div>
          {selection ? (
            <div className="selectionLive">
              <small>SELECTED · SCRATCH</small>
              <strong>{selection.tag}{selection.id ? `#${selection.id}` : ""}{selection.classes.map((name) => `.${name}`).join("")}</strong>
              <div className="sourceRef">
                <b>Source</b>
                <code>scratch/index.html</code>
                <span>{selection.styleTargets && Object.keys(selection.styleTargets).length ? "Live CSS ownership resolved" : "DOM selection live"}</span>
                <div className="sourceActions">
                  <button disabled={!hasNumericStyle("fontSize")} onClick={() => void changeNumericStyle("font-size", "fontSize", -4)}>Font -4</button>
                  <button disabled={!hasNumericStyle("fontSize")} onClick={() => void changeNumericStyle("font-size", "fontSize", 4)}>Font +4</button>
                  <button disabled={!hasNumericStyle("gap")} onClick={() => void changeNumericStyle("gap", "gap", -4)}>Gap -4</button>
                  <button disabled={!hasNumericStyle("gap")} onClick={() => void changeNumericStyle("gap", "gap", 4)}>Gap +4</button>
                  <button disabled={!hasNumericStyle("borderRadius")} onClick={() => void changeNumericStyle("border-radius", "borderRadius", -4)}>Radius -4</button>
                  <button disabled={!hasNumericStyle("borderRadius")} onClick={() => void changeNumericStyle("border-radius", "borderRadius", 4)}>Radius +4</button>
                  <button disabled={scratchUndoDepth === 0} onClick={() => void undoLastStyleEdit()}>Undo {scratchUndoDepth ? `(${scratchUndoDepth})` : ""}</button>
                </div>
                <div className="styleOwners">
                  {["font-size", "gap", "border-radius"].map((property) => {
                    const label = ownerLabel(property);
                    return label ? <small key={property}>{label}</small> : null;
                  })}
                </div>
                {lastPatch ? <small className="patchStatus">wrote {lastPatch.property}: {lastPatch.value}{lastPatchMs === null ? "" : ` · ${lastPatchMs.toFixed(1)} ms`}</small> : null}
                {editError ? <small className="patchStatus">edit error: {editError}</small> : null}
              </div>
              <div className="kv"><span>box</span><span>{selection.rect.x.toFixed(0)}, {selection.rect.y.toFixed(0)} · {selection.rect.width.toFixed(0)} × {selection.rect.height.toFixed(0)}</span></div>
              <div className="kv"><span>text</span><span>{selection.text || "-"}</span></div>
              <section><b>DOM path</b><ol>{selection.path.map((part, index) => <li key={`${part}-${index}`}>{part}</li>)}</ol></section>
              <section><b>Computed</b>{Object.entries(selection.styles).map(([key, value]) => <p key={key}>{key} &nbsp; {value}</p>)}</section>
            </div>
          ) : (
            <div className="selection"><small>SELECTED</small><strong>Nothing yet</strong><span>Click an element in the canvas...</span></div>
          )}
          <div className="perf">
            <div><span>Rust IPC</span><strong>{latency === null ? "-" : `${latency.toFixed(2)} ms`}</strong></div>
            <div><span>Scratch</span><strong>HTML · CSS · JS</strong></div>
            <button onClick={() => void benchmark()}>Benchmark ×20</button>
          </div>
        </aside>
      </section>
    </main>
  );
}
