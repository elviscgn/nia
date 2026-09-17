import { useEffect, useRef, useState } from "react";
import { scratchEditPart, type ScratchPart } from "./lib/scratch-code";
import type { ScratchDocument, ScratchSnapshot } from "./lib/scratch";
import "./scratch-code.css";

type Props = {
  document: ScratchDocument | null;
  onSaved: (snapshot: ScratchSnapshot) => void;
};

const LABELS: Record<ScratchPart, string> = {
  html: "index.html",
  css: "styles.css",
  js: "script.js",
};

function emptyDocument(): ScratchDocument {
  return { html: "", css: "", js: "" };
}

export default function ScratchCodePanel({ document, onSaved }: Props) {
  const [part, setPart] = useState<ScratchPart>("html");
  const [draft, setDraft] = useState<ScratchDocument>(() => document ?? emptyDocument());
  const [status, setStatus] = useState("Rust-backed Scratch files");
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ part: ScratchPart; content: string } | null>(null);
  const saveSequence = useRef(0);

  useEffect(() => {
    if (!document || pendingRef.current) return;
    setDraft(document);
  }, [document]);

  async function flush() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const sequence = ++saveSequence.current;
    setStatus(`Saving ${LABELS[pending.part]}...`);

    try {
      const snapshot = await scratchEditPart(pending.part, pending.content);
      if (sequence !== saveSequence.current || pendingRef.current) return;
      setDraft(snapshot.document);
      setStatus(`${LABELS[pending.part]} saved in Rust · v${snapshot.version}`);
      onSaved(snapshot);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function scheduleSave(nextPart: ScratchPart, content: string) {
    pendingRef.current = { part: nextPart, content };
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), 180);
  }

  function updateCurrent(content: string) {
    setDraft((current) => ({ ...current, [part]: content }));
    setStatus(`Editing ${LABELS[part]}`);
    scheduleSave(part, content);
  }

  function switchPart(nextPart: ScratchPart) {
    if (nextPart === part) return;
    void flush();
    setPart(nextPart);
  }

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (pendingRef.current) void flush();
  }, []);

  return (
    <section className="scratchCodePanel">
      <header className="scratchCodeHeader">
        <div className="scratchCodeTabs">
          {(Object.keys(LABELS) as ScratchPart[]).map((key) => (
            <button
              key={key}
              className={part === key ? "active" : ""}
              onClick={() => switchPart(key)}
            >
              {LABELS[key]}
            </button>
          ))}
        </div>
        <small>{status}</small>
      </header>
      <textarea
        className="scratchCodeEditor"
        value={draft[part]}
        onChange={(event) => updateCurrent(event.target.value)}
        spellCheck={false}
        aria-label={`Edit ${LABELS[part]}`}
      />
    </section>
  );
}
