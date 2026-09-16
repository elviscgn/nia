import { useEffect, useRef, useState } from "react";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";
import {
  CANVAS_ORIGIN,
  canvasCdpEvaluate,
  canvasReportSelection,
  canvasStatus,
  parseCanvasMessage,
  requestCanvasInspect,
  type CanvasSelection,
  type CanvasStatus,
} from "./lib/canvas";

export default function App() {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [canvas, setCanvas] = useState<CanvasStatus | null>(null);
  const [cdp, setCdp] = useState<string>("cdp: …");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoInspected = useRef(false);

  useEffect(() => { coreHealth().then(setHealth).catch(() => {}); }, []);
  useEffect(() => { canvasStatus().then(setCanvas).catch(() => {}); }, []);

  // CDP self-check: evaluate JS in this webview through Rust's DevTools
  // protocol path and show the answer.
  useEffect(() => {
    canvasCdpEvaluate("({title: document.title, url: location.href})")
      .then((v) => setCdp(`cdp: ok ${JSON.stringify(v)}`))
      .catch((e) => setCdp(`cdp: error ${String(e)}`));
  }, []);

  // Canvas bridge: ready / click-selection messages from the sample iframe.
  // Every selection round-trips through Rust before it is displayed.
  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const msg = parseCanvasMessage(event);
      if (!msg) return;
      if (msg.kind === "nia:ready") {
        setCanvas((c) => (c ? { ...c, reachable: true } : c));
        // Automatic end-to-end check: inspect the sample hero without clicks.
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
    setLatency(samples.reduce((a,b)=>a+b,0)/samples.length);
  }

  return <main className="app">
    <header className="topbar">
      <div className="brand"><div className="mark"><i/><i/></div><strong>Nia</strong><button>website⌄</button><span>main</span></div>
      <nav><button className="active">Canvas</button><button>Code</button><button>Split</button><button>Scratch</button></nav>
      <div className="actions"><span>{health ? "CEF + Rust" : "connecting…"}</span><button>Model · Auto</button><button className="run">Run</button></div>
    </header>

    <section className="workspace">
      <aside className="rail"><div className="railActive">A</div><div>V</div><div>F</div><div>Δ</div><div>⌕</div></aside>
      <aside className="agent">
        <div className="panelTitle">Nia Agent <span>•••</span></div>
        <div className="vision"><b>VISION CONTEXT</b><p>Warm editorial interface. Restrained amber. Dense typography. Minimal decoration.</p><small>Project vision · 3 refs</small></div>
        <div className="chat"><div className="user">Make the hero feel more focused without making it sterile.</div><p><b>Nia</b><br/>I’ll preserve hierarchy and reduce noise around the primary action.</p></div>
        <div className="composer"><div className="chips"><span>HeroHeading ×</span><span>Vision ×</span></div><textarea placeholder="Ask Nia…"/><div className="sendRow"><span>Fast</span><button>↑</button></div></div>
      </aside>

      <section className="center">
        <div className="canvasToolbar"><span>↖ &nbsp; ✋</span><span>Desktop · 1440 × 900</span><span>Fit &nbsp; 100%</span></div>
        <div className="canvas">
          <div className="browser"><div className="browserBar"><span>● ● ●</span><div>{CANVAS_ORIGIN}</div><span className="pill">{canvas ? (canvas.reachable ? "canvas: live" : "canvas: down") : "canvas: …"}</span><button onClick={() => { if (iframeRef.current) iframeRef.current.src = CANVAS_ORIGIN; }}>Reload</button></div>
            <iframe ref={iframeRef} className="canvasFrame" title="Nia canvas" src={CANVAS_ORIGIN} />
          </div>
        </div>
        <div className="terminal"><div className="terminalTabs">Terminal &nbsp;&nbsp; Problems &nbsp;&nbsp; Console &nbsp;&nbsp; Network &nbsp;&nbsp; Tests</div><pre>{cdp}{"\n"}nia › dev server ready · CEF canvas online</pre></div>
      </section>

      <aside className="inspector"><div className="tabs"><b>Inspect</b><span>Components</span><span>Page</span></div>
        {selection ? <div className="selectionLive">
          <small>SELECTED · VIA RUST</small>
          <strong>{selection.tag}{selection.id ? `#${selection.id}` : ""}{selection.classes.map((c) => `.${c}`).join("")}</strong>
          <div className="kv"><span>box</span><span>{selection.rect.x}, {selection.rect.y} · {selection.rect.width} × {selection.rect.height}</span></div>
          <div className="kv"><span>text</span><span>{selection.text || "—"}</span></div>
          <section><b>DOM path</b><ol>{selection.path.map((p) => <li key={p}>{p}</li>)}</ol></section>
          <section><b>Computed</b>{Object.entries(selection.styles).map(([k, v]) => <p key={k}>{k} &nbsp; {v}</p>)}</section>
        </div> : <div className="selection"><small>SELECTED</small><strong>Nothing yet</strong><span>Click an element in the canvas…</span></div>}
        <div className="perf"><div><span>Rust IPC</span><strong>{latency === null ? "—" : `${latency.toFixed(2)} ms`}</strong></div><button onClick={benchmark}>Benchmark ×20</button></div>
      </aside>
    </section>
  </main>;
}
