import { useEffect } from "react";
import { initNiaCanvasBridge } from "./instrument";
import "./styles.css";

const SOURCE_FILE = "sample/src/app.tsx";
const STYLE_FILE = "sample/src/styles.css";

function sourceMeta(line: number, styleSelector: string) {
  return {
    "data-nia-source-file": SOURCE_FILE,
    "data-nia-source-line": String(line),
    "data-nia-source-column": "7",
    "data-nia-style-file": STYLE_FILE,
    "data-nia-style-selector": styleSelector,
  };
}

// Tiny sample app. Deliberately plain so the canvas can prove inspection,
// source identity, deterministic source edits, and HMR.
export default function SampleApp() {
  useEffect(() => {
    initNiaCanvasBridge();
  }, []);

  return (
    <div className="sample" {...sourceMeta(26, ".sample")}>
      <header className="sample-nav" id="site-nav" {...sourceMeta(27, ".sample-nav")}>
        <strong className="logo">Sample</strong>
        <nav>
          <span>Product</span>
          <span>Docs</span>
          <span>About</span>
        </nav>
      </header>
      <main className="sample-main" {...sourceMeta(35, ".sample-main")}>
        <h1 id="hero-title" className="hero" {...sourceMeta(36, ".hero")}>
          From ideas to interfaces.
        </h1>
        <p id="hero-sub" className="sub" {...sourceMeta(39, ".sub")}>
          A visual coding workspace for humans and agents.
        </p>
        <button id="hero-cta" className="cta primary" {...sourceMeta(42, ".cta")}>
          Start building
        </button>
        <section className="cards" id="feature-cards" {...sourceMeta(45, ".cards")}>
          <article className="card" id="card-canvas" {...sourceMeta(46, ".card")}>
            <h2>Canvas</h2>
            <p>See the running app.</p>
          </article>
          <article className="card" id="card-inspect" {...sourceMeta(50, ".card")}>
            <h2>Inspect</h2>
            <p>Click anything.</p>
          </article>
        </section>
      </main>
    </div>
  );
}
