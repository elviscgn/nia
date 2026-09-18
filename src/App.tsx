import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ScratchCodePanel from "./ScratchCodePanel";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";
import {
  projectGet,
  projectPickFolder,
  projectProcessStart,
  projectProcessStatus,
  projectProcessStop,
  type ProjectProcess,
  type ProjectSession,
} from "./lib/project";
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

const EDITABLE_PROPERTIES = [
  { property: "font-size", key: "fontSize", label: "Font size", step: 4 },
  { property: "gap", key: "gap", label: "Gap", step: 4 },
  { property: "border-radius", key: "borderRadius", label: "Radius", step: 4 },
] as const;

export default function App({ agentPanel, modelLabel, onOpenModelSettings }: AppProps) {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [project, setProject] = useState<ProjectSession | null>(null);
  const [projectOpening, setProjectOpening] = useState(false);
  const [projectProcess, setProjectProcess] = useState<ProjectProcess | null>(null);
  const [projectProcessBusy, setProjectProcessBusy] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("inspect");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("canvas");
  const [scratchDocument, setScratchDocument] = useState<ScratchDocument | null>(null);
  const [scratchUndoDepth, setScratchUndoDepth] = useState(0);
  const [lastPatch, setLastPatch] = useState<ScratchStylePatchResult | null>(null);
  const [lastPatchMs, setLastPatchMs] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoInspected = useRef(false);

  const scratchSrcDoc = useMemo(() => buildScratchPreview(scratchDocument), [scratchDocument]);
  const canvasVisible = workspaceView !== "code";
  const liveProjectUrl = projectProcess?.running ? projectProcess.url : null;

  useEffect(() => {
    coreHealth().then(setHealth).catch(() => {});
    projectGet().then(setProject).catch((error) => {
      setProjectError(error instanceof Error ? error.message : String(error));
    });
    projectProcessStatus().then(setProjectProcess).catch(() => {});
    scratchGet()
      .then((snapshot) => {
        setScratchDocument(snapshot.document);
        setScratchUndoDepth(snapshot.undoDepth);
      })
      .catch((error) => setEditError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!canvasVisible || projectProcess?.url) return;
    postCanvasMode(iframeRef.current, canvasMode, "*");
  }, [canvasMode, scratchSrcDoc, workspaceView, canvasVisible, projectProcess?.url]);

  useEffect(() => {
    if (!projectProcess?.running) return;
    const poll = window.setInterval(() => {
      void projectProcessStatus()
        .then(setProjectProcess)
        .catch((error) => setProjectError(error instanceof Error ? error.message : String(error)));
    }, 500);
    return () => window.clearInterval(poll);
  }, [projectProcess?.running]);

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

  async function openProject() {
    if (projectOpening) return;
    setProjectOpening(true);
    setProjectError(null);
    try {
      const next = await projectPickFolder();
      if (next) {
        setProject(next);
        setProjectProcess(await projectProcessStatus());
        setSelection(null);
        setLastPatch(null);
        setLastPatchMs(null);
        setEditError(null);
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectOpening(false);
    }
  }

  async function toggleProjectProcess() {
    if (projectProcessBusy || !project?.devScript) return;
    setProjectProcessBusy(true);
    setProjectError(null);
    try {
      const next = projectProcess?.running
        ? await projectProcessStop()
        : await projectProcessStart();
      setProjectProcess(next);
      if (next.running) setWorkspaceView("canvas");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectProcessBusy(false);
    }
  }

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

  const selectedName = selection
    ? `${selection.tag}${selection.id ? `#${selection.id}` : ""}${selection.classes.map((name) => `.${name}`).join("")}`
    : "Nothing selected";

  const sourceLabel = selection?.source
    ? `${selection.source.file}:${selection.source.line}:${selection.source.column}`
    : "scratch/index.html";

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark"><i/><i/></div>
          <strong>Nia</strong>
          <button
            className="projectButton"
            onClick={() => void openProject()}
            title={project?.root ?? "Open a project"}
          >
            {projectOpening ? "Opening..." : project?.name ?? "Open project"}
          </button>
          <span className="projectMeta">{project?.framework ?? "local"}{project?.packageManager ? ` · ${project.packageManager}` : ""}</span>
        </div>
        <nav>
          <button className={workspaceView === "canvas" ? "active" : ""} onClick={() => setWorkspaceView("canvas")}>Canvas</button>
          <button className={workspaceView === "code" ? "active" : ""} onClick={() => setWorkspaceView("code")}>Code</button>
          <button className={workspaceView === "split" ? "active" : ""} onClick={() => setWorkspaceView("split")}>Split</button>
        </nav>
        <div className="actions">
          <span>{health ? "CEF + Rust" : "connecting..."}</span>
          <button onClick={onOpenModelSettings}>{modelLabel}</button>
          <button
            className="run"
            disabled={!project?.devScript || projectProcessBusy}
            onClick={() => void toggleProjectProcess()}
          >
            {projectProcessBusy ? "Working..." : projectProcess?.running ? "Stop" : "Run"}
          </button>
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

        <section className={`center ${terminalOpen ? "terminalOpen" : "terminalClosed"}`}>
          <div className="canvasToolbar">
            <span className="modeSwitch">
              <button disabled={!canvasVisible || Boolean(liveProjectUrl)} className={canvasVisible && !liveProjectUrl && canvasMode === "inspect" ? "active" : ""} onClick={() => switchCanvasMode("inspect")}>Inspect</button>
              <button disabled={!canvasVisible || Boolean(liveProjectUrl)} className={canvasVisible && !liveProjectUrl && canvasMode === "interact" ? "active" : ""} onClick={() => switchCanvasMode("interact")}>Interact</button>
            </span>
            <span>{workspaceView === "code" ? "Raw Scratch source" : liveProjectUrl ? "Project canvas · live dev server" : "Desktop · 1440 × 900"}</span>
            <span>
              <span className="scratchModeBadge"><i>⌁</i> {liveProjectUrl ? "Project" : "Scratch"}</span>
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
                    <div>{liveProjectUrl ?? "scratch://index.html"}</div>
                    <span className="pill">{liveProjectUrl ? "project: live" : "scratch: live"}</span>
                    <button onClick={() => {
                      if (!iframeRef.current) return;
                      if (liveProjectUrl) iframeRef.current.src = liveProjectUrl;
                      else iframeRef.current.srcdoc = scratchSrcDoc;
                    }}>Reload</button>
                  </div>
                  {liveProjectUrl ? (
                    <iframe
                      ref={iframeRef}
                      className="canvasFrame"
                      title="Nia project canvas"
                      src={liveProjectUrl}
                    />
                  ) : (
                    <iframe
                      ref={iframeRef}
                      className="canvasFrame"
                      title="Nia Scratch canvas"
                      srcDoc={scratchSrcDoc}
                      sandbox="allow-scripts allow-forms allow-modals"
                    />
                  )}
                </div>
              </div>
            ) : null}

            {workspaceView !== "canvas" ? (
              <ScratchCodePanel document={scratchDocument} onSaved={applyScratchSnapshot} />
            ) : null}
          </div>

          <div className="terminal">
            <button className="terminalTabs" onClick={() => setTerminalOpen((open) => !open)}>
              <span>Terminal</span><span>Problems</span><span>Console</span><span>Network</span><span>Tests</span><b>{terminalOpen ? "⌄" : "⌃"}</b>
            </button>
            {terminalOpen ? (
              <pre>
                {project ? `project › ${project.root}\n` : ""}
                {projectProcess?.command ? `process › ${projectProcess.command}\n` : project?.devCommand ? `run › ${project.devCommand}\n` : ""}
                {projectProcess?.logs?.length ? `${projectProcess.logs.slice(-8).join("\n")}\n` : ""}
                {liveProjectUrl ? `canvas › ${liveProjectUrl}\n` : "scratch › raw HTML/CSS/JS canvas\n"}
                nia › Rust core online · undo {scratchUndoDepth}
                {projectError ? `\nproject error › ${projectError}` : ""}
              </pre>
            ) : null}
          </div>
        </section>

        <aside className="inspector">
          <div className="tabs"><b>Inspect</b><span>DOM</span><span>Page</span></div>
          {selection ? (
            <div className="selectionLive">
              <div className="selectionHeader">
                <div><small>SELECTED · SCRATCH</small><strong>{selectedName}</strong></div>
                <button disabled={scratchUndoDepth === 0} onClick={() => void undoLastStyleEdit()}>Undo{scratchUndoDepth ? ` ${scratchUndoDepth}` : ""}</button>
              </div>

              <section className="inspectorBlock sourceBlock">
                <div className="sectionTitle"><b>Source</b><code>{sourceLabel}</code></div>
                {selection.source?.classValue ? <div className="sourceMeta"><span>className</span><code>"{selection.source.classValue}"</code></div> : null}
                <div className="sourceMeta"><span>selector</span><code>{selection.selector}</code></div>
              </section>

              <section className="inspectorBlock">
                <div className="sectionTitle"><b>Properties</b><span>{selection.rect.width.toFixed(0)} × {selection.rect.height.toFixed(0)}</span></div>
                <div className="propertyRows">
                  {EDITABLE_PROPERTIES.map(({ property, key, label, step }) => {
                    const numericValue = Number.parseFloat(selection.styles[key] ?? "");
                    const available = Number.isFinite(numericValue);
                    const owner = selection.styleTargets?.[property];
                    return (
                      <div className="propertyRow" key={property}>
                        <div className="propertyIdentity">
                          <span>{label}</span>
                          <small>{owner ? owner.selector : "computed"}</small>
                        </div>
                        <div className="stepper">
                          <button disabled={!available} onClick={() => void changeNumericStyle(property, key, -step)}>−</button>
                          <code>{available ? `${numericValue}px` : "auto"}</code>
                          <button disabled={!available} onClick={() => void changeNumericStyle(property, key, step)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {lastPatch ? <div className="patchStatus">Saved {lastPatch.property} {lastPatch.value}{lastPatchMs === null ? "" : ` · ${lastPatchMs.toFixed(1)} ms`}</div> : null}
                {editError ? <div className="patchStatus">Edit error: {editError}</div> : null}
              </section>

              <section className="inspectorBlock compactBlock">
                <div className="sectionTitle"><b>Element</b></div>
                <div className="metaGrid">
                  <span>Position</span><code>{selection.rect.x.toFixed(0)}, {selection.rect.y.toFixed(0)}</code>
                  <span>Text</span><code>{selection.text || "-"}</code>
                </div>
              </section>

              <details className="debugDetails">
                <summary>DOM path</summary>
                <ol>{selection.path.map((part, index) => <li key={`${part}-${index}`}>{part}</li>)}</ol>
              </details>

              <details className="debugDetails">
                <summary>Computed styles</summary>
                <div className="computedGrid">
                  {Object.entries(selection.styles).map(([key, value]) => (
                    <span className="computedPair" key={key}><span>{key}</span><code>{value}</code></span>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <div className="emptyInspector">
              <span>Inspect mode</span>
              <strong>Click anything on the canvas</strong>
              <p>Nia will resolve the DOM node, source identity, and editable style owner.</p>
            </div>
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
