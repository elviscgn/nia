import { useEffect, useMemo, useRef, useState } from "react";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";
import {
  CANVAS_ORIGIN,
  canvasCdpEvaluate,
  canvasHistoryState,
  canvasReplaceClassToken,
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
import {
  buildScratchPreview,
  loadScratchDocument,
  patchScratchCss,
  saveScratchDocument,
  type ScratchDocument,
} from "./lib/scratch";

const UTILITY_BASE: Record<string, string> = {
  "font-size": "text",
  gap: "gap",
  "border-radius": "rounded",
  padding: "p",
  "margin-top": "mt",
  "margin-bottom": "mb",
};

const UTILITY_PATTERN: Record<string, RegExp> = {
  "font-size": /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])$/,
  gap: /^gap-(?:0|px|\d+(?:\.\d+)?|\[[^\]]+\])$/,
  "border-radius": /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/,
  padding: /^p-(?:0|px|\d+(?:\.\d+)?|\[[^\]]+\])$/,
  "margin-top": /^mt-(?:auto|0|px|\d+(?:\.\d+)?|\[[^\]]+\])$/,
  "margin-bottom": /^mb-(?:auto|0|px|\d+(?:\.\d+)?|\[[^\]]+\])$/,
};

function utilityParts(token: string) {
  const variantIndex = token.lastIndexOf(":");
  const variants = variantIndex >= 0 ? token.slice(0, variantIndex + 1) : "";
  let utility = variantIndex >= 0 ? token.slice(variantIndex + 1) : token;
  const important = utility.startsWith("!") ? "!" : "";
  if (important) utility = utility.slice(1);
  return { variants, important, utility };
}

function utilityMatchesProperty(token: string, property: string) {
  const pattern = UTILITY_PATTERN[property];
  return pattern ? pattern.test(utilityParts(token).utility) : false;
}

function utilityTokenForProperty(classValue: string, property: string) {
  return classValue
    .split(/\s+/)
    .filter(Boolean)
    .find((token) => utilityMatchesProperty(token, property)) ?? null;
}

function nextUtilityPxToken(token: string, property: string, next: number) {
  const base = UTILITY_BASE[property];
  if (!base || !utilityMatchesProperty(token, property)) return null;
  const { variants, important } = utilityParts(token);
  const value = Number.isInteger(next) ? String(next) : next.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${variants}${important}${base}-[${value}px]`;
}

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
  const [editError, setEditError] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [scratchMode, setScratchMode] = useState(false);
  const [scratchDocument, setScratchDocument] = useState<ScratchDocument>(() => loadScratchDocument());
  const [scratchHistory, setScratchHistory] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const selectionRef = useRef<CanvasSelection | null>(null);
  const autoInspected = useRef(false);

  const scratchSrcDoc = useMemo(() => buildScratchPreview(scratchDocument), [scratchDocument]);
  const targetOrigin = scratchMode ? "*" : CANVAS_ORIGIN;
  const visibleUndoDepth = scratchMode ? scratchHistory.length : undoDepth;

  useEffect(() => { coreHealth().then(setHealth).catch(() => {}); }, []);
  useEffect(() => { canvasStatus().then(setCanvas).catch(() => {}); }, []);
  useEffect(() => { canvasHistoryState().then((state) => setUndoDepth(state.undoDepth)).catch(() => {}); }, []);
  useEffect(() => { postCanvasMode(iframeRef.current, canvasMode, targetOrigin); }, [canvasMode, targetOrigin]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveScratchDocument(scratchDocument), 120);
    return () => window.clearTimeout(timer);
  }, [scratchDocument]);

  useEffect(() => {
    selectionRef.current = null;
    setSelection(null);
    setLastPatch(null);
    setLastPatchMs(null);
    setEditError(null);
    autoInspected.current = false;
  }, [scratchMode]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (scratchMode) return;
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
  }, [scratchMode]);

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
        setCanvas((current) => current ? { ...current, reachable: true } : current);
        postCanvasMode(iframeRef.current, canvasMode, targetOrigin);
        if (!autoInspected.current) {
          autoInspected.current = true;
          requestCanvasInspect(iframeRef.current, scratchMode ? "h1" : "#hero-title", targetOrigin);
        }
        return;
      }

      if (scratchMode) {
        selectionRef.current = msg.selection;
        setSelection(msg.selection);
        return;
      }

      try {
        const resolved = await canvasReportSelection(msg.selection);
        const browserSource = msg.selection.source;
        const selectionWithTargets: CanvasSelection = {
          ...resolved,
          source: resolved.source
            ? {
                ...resolved.source,
                classFile: browserSource?.classFile,
                classLine: browserSource?.classLine,
                classColumn: browserSource?.classColumn,
                classValue: browserSource?.classValue,
              }
            : resolved.source,
          styleTargets: msg.selection.styleTargets ?? {},
        };
        selectionRef.current = selectionWithTargets;
        setSelection(selectionWithTargets);
      } catch {
        selectionRef.current = msg.selection;
        setSelection(msg.selection);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [scratchMode, canvasMode, targetOrigin]);

  async function benchmark() {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) samples.push(await coreRoundTrip());
    setLatency(samples.reduce((a, b) => a + b, 0) / samples.length);
  }

  async function changeNumericStyle(property: string, computedKey: string, delta: number) {
    if (!selection) return;
    const current = Number.parseFloat(selection.styles[computedKey] ?? "");
    if (!Number.isFinite(current)) return;

    const exactTarget = selection.styleTargets?.[property];
    const file = exactTarget?.file || selection.source?.styleFile || "";
    const selector = exactTarget?.selector || selection.source?.styleSelector || "";
    const next = Math.max(0, current + delta);
    const nextValue = `${next}px`;

    if (scratchMode) {
      const scratchSelector = exactTarget?.selector || selection.selector;
      if (!scratchSelector) return;
      previewCanvasStyle(
        iframeRef.current,
        scratchSelector,
        property,
        nextValue,
        selection.selector,
        "*",
      );
      const started = performance.now();
      const previousCss = scratchDocument.css;
      const patchedCss = patchScratchCss(previousCss, scratchSelector, property, nextValue);
      setScratchHistory((history) => [...history.slice(-99), previousCss]);
      setScratchDocument((document) => ({ ...document, css: patchedCss }));
      setLastPatch({
        file: "scratch/styles.css",
        selector: scratchSelector,
        property,
        previousValue: exactTarget?.value ?? null,
        value: nextValue,
        undoDepth: scratchHistory.length + 1,
      });
      setLastPatchMs(performance.now() - started);
      setEditError(null);
      window.setTimeout(() => requestCanvasInspect(iframeRef.current, selection.selector, "*"), 180);
      return;
    }

    const source = selection.source;
    const classValue = source?.classValue || selection.classes.join(" ");
    const classTokens = classValue.split(/\s+/).filter(Boolean);
    const directUtilityToken = utilityTokenForProperty(classValue, property);
    const ownedUtilityToken = exactTarget?.classToken
      && classTokens.includes(exactTarget.classToken)
      && utilityMatchesProperty(exactTarget.classToken, property)
        ? exactTarget.classToken
        : null;
    const oldClassToken = directUtilityToken || ownedUtilityToken || "";
    const nextClassToken = oldClassToken ? nextUtilityPxToken(oldClassToken, property, next) : null;
    const classFile = source?.classFile || source?.file;
    const classLine = source?.classLine || source?.line;
    const classColumn = source?.classColumn || source?.column;
    const canEditClassToken = Boolean(
      nextClassToken
      && classFile
      && classValue
      && classLine
      && classColumn,
    );

    if (!canEditClassToken && (!file || !selector)) return;

    const previewSelector = canEditClassToken ? selection.selector : selector;
    previewCanvasStyle(
      iframeRef.current,
      previewSelector,
      property,
      nextValue,
      selection.selector,
    );

    setEditError(null);
    const started = performance.now();
    try {
      const patch = canEditClassToken
        ? await canvasReplaceClassToken(
            classFile!,
            classLine!,
            classColumn!,
            classValue,
            oldClassToken,
            nextClassToken!,
          )
        : await canvasSetStylePx(file, selector, property, next);

      setLastPatch(patch);
      setLastPatchMs(performance.now() - started);
      setUndoDepth(patch.undoDepth);

      window.setTimeout(() => {
        clearCanvasStylePreview(iframeRef.current);
        requestCanvasInspect(iframeRef.current, selection.selector);
      }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEditError(message);
      clearCanvasStylePreview(iframeRef.current);
      requestCanvasInspect(iframeRef.current, selection.selector);
    }
  }

  async function undoLastStyleEdit() {
    const inspectSelector = selection?.selector;
    setEditError(null);

    if (scratchMode) {
      const previousCss = scratchHistory[scratchHistory.length - 1];
      if (previousCss === undefined) return;
      setScratchHistory((history) => history.slice(0, -1));
      setScratchDocument((document) => ({ ...document, css: previousCss }));
      setLastPatch(null);
      setLastPatchMs(null);
      if (inspectSelector) {
        window.setTimeout(() => requestCanvasInspect(iframeRef.current, inspectSelector, "*"), 180);
      }
      return;
    }

    clearCanvasStylePreview(iframeRef.current);
    try {
      const result = await canvasUndoStyle();
      setUndoDepth(result.undoDepth);
      setLastPatch(null);
      setLastPatchMs(null);
      if (inspectSelector) {
        window.setTimeout(() => requestCanvasInspect(iframeRef.current, inspectSelector), 250);
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  }

  function switchCanvasMode(nextMode: CanvasMode) {
    setCanvasMode(nextMode);
    postCanvasMode(iframeRef.current, nextMode, targetOrigin);
  }

  function toggleScratchMode() {
    setScratchMode((current) => !current);
  }

  const hasNumericStyle = (key: string) =>
    Number.isFinite(Number.parseFloat(selection?.styles[key] ?? ""));

  const ownerLabel = (property: string) => {
    const target = selection?.styleTargets?.[property];
    if (!target) return null;
    const owner = target.classToken ? `class ${target.classToken}` : target.selector;
    const classSource = target.classToken && selection?.source?.classFile
      ? ` @ ${selection.source.classFile}:${selection.source.classLine ?? 0}:${selection.source.classColumn ?? 0}`
      : "";
    return `${property} -> ${owner} · ${target.file}${classSource}`;
  };

  return <main className="app">
    <header className="topbar">
      <div className="brand"><div className="mark"><i/><i/></div><strong>Nia</strong><button>website⌄</button><span>main</span></div>
      <nav><button className="active">Canvas</button><button>Code</button><button>Split</button></nav>
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
        <div className="canvasToolbar">
          <span>
            <button className={canvasMode === "inspect" ? "active" : ""} onClick={() => switchCanvasMode("inspect")}>Inspect</button>
            <button className={canvasMode === "interact" ? "active" : ""} onClick={() => switchCanvasMode("interact")}>Interact</button>
          </span>
          <span>Desktop · 1440 × 900</span>
          <span><button className={scratchMode ? "active" : ""} onClick={toggleScratchMode}>Scratch</button>&nbsp; Fit &nbsp; 100%</span>
        </div>
        <div className="canvas">
          <div className="browser"><div className="browserBar"><span>● ● ●</span><div>{scratchMode ? "scratch://index.html" : CANVAS_ORIGIN}</div><span className="pill">{scratchMode ? "scratch: live" : canvas ? (canvas.reachable ? "canvas: live" : "canvas: down") : "canvas: ..."}</span><button onClick={() => {
              if (!iframeRef.current) return;
              if (scratchMode) iframeRef.current.srcdoc = scratchSrcDoc;
              else iframeRef.current.src = CANVAS_ORIGIN;
            }}>Reload</button></div>
            <iframe
              ref={iframeRef}
              className="canvasFrame"
              title={scratchMode ? "Nia scratch canvas" : "Nia canvas"}
              src={scratchMode ? undefined : CANVAS_ORIGIN}
              srcDoc={scratchMode ? scratchSrcDoc : undefined}
              sandbox={scratchMode ? "allow-scripts allow-forms allow-modals" : undefined}
            />
          </div>
        </div>
        <div className="terminal"><div className="terminalTabs">Terminal &nbsp;&nbsp; Problems &nbsp;&nbsp; Console &nbsp;&nbsp; Network &nbsp;&nbsp; Tests</div><pre>{scratchMode ? "scratch › raw HTML/CSS/JS canvas" : cdp}{"\n"}nia › {scratchMode ? "scratch document live" : "dev server ready · CEF canvas online"}</pre></div>
      </section>

      <aside className="inspector"><div className="tabs"><b>Inspect</b><span>Components</span><span>Page</span></div>
        {selection ? <div className="selectionLive">
          <small>SELECTED · {scratchMode ? "SCRATCH" : "VIA RUST"}</small>
          <strong>{selection.tag}{selection.id ? `#${selection.id}` : ""}{selection.classes.map((c) => `.${c}`).join("")}</strong>
          {selection.source ? <div className="sourceRef">
            <b>Source</b>
            <code>{selection.source.file}:{selection.source.line}:{selection.source.column}</code>
            {!scratchMode && selection.source.classValue ? <small>className "{selection.source.classValue}" · {selection.source.classFile}:{selection.source.classLine}:{selection.source.classColumn}</small> : null}
            <span>{selection.source.styleSelector} · {selection.source.styleFile}{selection.source.styleLine ? `:${selection.source.styleLine}` : ""}</span>
            <div className="sourceActions">
              <button disabled={!hasNumericStyle("fontSize")} onClick={() => changeNumericStyle("font-size", "fontSize", -4)}>Font -4</button>
              <button disabled={!hasNumericStyle("fontSize")} onClick={() => changeNumericStyle("font-size", "fontSize", 4)}>Font +4</button>
              <button disabled={!hasNumericStyle("gap")} onClick={() => changeNumericStyle("gap", "gap", -4)}>Gap -4</button>
              <button disabled={!hasNumericStyle("gap")} onClick={() => changeNumericStyle("gap", "gap", 4)}>Gap +4</button>
              <button disabled={!hasNumericStyle("borderRadius")} onClick={() => changeNumericStyle("border-radius", "borderRadius", -4)}>Radius -4</button>
              <button disabled={!hasNumericStyle("borderRadius")} onClick={() => changeNumericStyle("border-radius", "borderRadius", 4)}>Radius +4</button>
              <button disabled={visibleUndoDepth === 0} onClick={undoLastStyleEdit}>Undo {visibleUndoDepth ? `(${visibleUndoDepth})` : ""}</button>
            </div>
            <div className="styleOwners">
              {["font-size", "gap", "border-radius"].map((property) => {
                const label = ownerLabel(property);
                return label ? <small key={property}>{label}</small> : null;
              })}
            </div>
            {lastPatch ? <small className="patchStatus">wrote {lastPatch.property}: {lastPatch.value}{lastPatchMs === null ? "" : ` · ${lastPatchMs.toFixed(1)} ms`}</small> : null}
            {editError ? <small className="patchStatus">edit error: {editError}</small> : null}
          </div> : <div className="sourceRef"><b>Source</b><span>No source metadata yet</span></div>}
          <div className="kv"><span>box</span><span>{selection.rect.x.toFixed(0)}, {selection.rect.y.toFixed(0)} · {selection.rect.width.toFixed(0)} × {selection.rect.height.toFixed(0)}</span></div>
          <div className="kv"><span>text</span><span>{selection.text || "-"}</span></div>
          <section><b>DOM path</b><ol>{selection.path.map((part, index) => <li key={`${part}-${index}`}>{part}</li>)}</ol></section>
          <section><b>Computed</b>{Object.entries(selection.styles).map(([key, value]) => <p key={key}>{key} &nbsp; {value}</p>)}</section>
        </div> : <div className="selection"><small>SELECTED</small><strong>Nothing yet</strong><span>Click an element in the canvas...</span></div>}
        <div className="perf">
          <div><span>Rust IPC</span><strong>{latency === null ? "-" : `${latency.toFixed(2)} ms`}</strong></div>
          <div><span>{scratchMode ? "Scratch" : "CSS index"}</span><strong>{scratchMode ? "HTML · CSS · JS" : styleIndex ? `v${styleIndex.version} · ${styleIndex.ruleCount} rules` : "..."}</strong></div>
          <button onClick={benchmark}>Benchmark ×20</button>
        </div>
      </aside>
    </section>
  </main>;
}
