import { useCallback, useEffect, useState, type MouseEvent } from "react";
import App from "./App";
import ScratchWorkspace from "./ScratchWorkspace";

export default function Root() {
  const [scratchOpen, setScratchOpen] = useState(false);

  const closeScratch = useCallback(() => setScratchOpen(false), []);

  useEffect(() => {
    if (!scratchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeScratch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scratchOpen, closeScratch]);

  const captureShellClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button") : null;
    if (!target || target.textContent?.trim() !== "Scratch") return;
    event.preventDefault();
    setScratchOpen(true);
  };

  return (
    <>
      <div onClickCapture={captureShellClick}>
        <App />
      </div>
      {scratchOpen ? <ScratchWorkspace onClose={closeScratch} /> : null}
    </>
  );
}
