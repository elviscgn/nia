import { useEffect, useState } from "react";
import { coreHealth, coreRoundTrip, type CoreHealth } from "./lib/core";

export default function App() {
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => { coreHealth().then(setHealth).catch(() => {}); }, []);

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
          <div className="browser"><div className="browserBar"><span>● ● ●</span><div>localhost:5173</div></div>
            <div className="site"><div className="siteNav"><b>Nia</b><span>Product &nbsp; Docs &nbsp; About</span></div>
              <div className="hero"><label>HeroHeading · HeroSection.tsx:28</label><h1>From ideas to interfaces.</h1><p>A visual coding workspace for humans and agents.</p><button>Start building</button></div>
            </div>
          </div>
        </div>
        <div className="terminal"><div className="terminalTabs">Terminal &nbsp;&nbsp; Problems &nbsp;&nbsp; Console &nbsp;&nbsp; Network &nbsp;&nbsp; Tests</div><pre>nia › dev server ready in 421ms\nwatching source · HMR connected · CEF canvas online</pre></div>
      </section>

      <aside className="inspector"><div className="tabs"><b>Inspect</b><span>Components</span><span>Page</span></div><div className="selection"><small>SELECTED</small><strong>HeroHeading</strong><span>React component</span><button>HeroSection.tsx · 28 ↗</button></div><section><b>Layout</b><p>Display &nbsp; flex</p><p>Gap &nbsp; 24</p></section><section><b>Typography</b><p>Size &nbsp; 72</p><p>Weight &nbsp; 700</p></section><div className="perf"><div><span>Rust IPC</span><strong>{latency === null ? "—" : `${latency.toFixed(2)} ms`}</strong></div><button onClick={benchmark}>Benchmark ×20</button></div></aside>
    </section>
  </main>;
}
