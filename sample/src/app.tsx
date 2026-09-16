import { useEffect } from "react";
import { initNiaCanvasBridge } from "./instrument";
import "./styles.css";

// Tiny sample app. Deliberately plain so the canvas can prove inspection,
// automatic source identity, deterministic source edits, and HMR.
export default function SampleApp() {
  useEffect(() => {
    initNiaCanvasBridge();
  }, []);

  return (
    <div className="sample">
      <header className="sample-nav" id="site-nav">
        <strong className="logo">Sample</strong>
        <nav>
          <span>Product</span>
          <span>Docs</span>
          <span>About</span>
        </nav>
      </header>
      <main className="sample-main">
        <h1 id="hero-title" className="hero">
          From ideas to interfaces.
        </h1>
        <p id="hero-sub" className="sub">
          A visual coding workspace for humans and agents.
        </p>
        <button id="hero-cta" className="cta primary">
          Start building
        </button>
        <section className="cards" id="feature-cards">
          <article className="card" id="card-canvas">
            <h2>Canvas</h2>
            <p>See the running app.</p>
          </article>
          <article className="card" id="card-inspect">
            <h2>Inspect</h2>
            <p>Click anything.</p>
          </article>
        </section>
      </main>
    </div>
  );
}
