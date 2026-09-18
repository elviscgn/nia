import { useEffect, useState, type KeyboardEvent } from "react";
import {
  scratchAgentHistory,
  scratchAgentRun,
  type ScratchAgentResponse,
  type ScratchChatEntry,
} from "./lib/agent";
import { scratchGet } from "./lib/scratch";
import { visionGet, visionSave, type VisionContext } from "./lib/vision";
import "./scratch-agent.css";

function selectionLabelFromSnapshot(snapshot: Awaited<ReturnType<typeof scratchGet>>) {
  const selection = snapshot.selection;
  if (!selection) return null;
  return `${selection.tag}${selection.id ? `#${selection.id}` : ""}${selection.classes[0] ? `.${selection.classes[0]}` : ""}`;
}

export default function ScratchAgentPanel() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectionLabel, setSelectionLabel] = useState<string | null>(null);
  const [messages, setMessages] = useState<ScratchChatEntry[]>([]);
  const [vision, setVision] = useState<VisionContext | null>(null);
  const [visionDraft, setVisionDraft] = useState("");
  const [referencesDraft, setReferencesDraft] = useState("");
  const [visionEditing, setVisionEditing] = useState(false);
  const [visionStatus, setVisionStatus] = useState("");

  useEffect(() => {
    scratchAgentHistory().then(setMessages).catch(() => {});
    scratchGet().then((snapshot) => setSelectionLabel(selectionLabelFromSnapshot(snapshot))).catch(() => {});
    visionGet()
      .then((next) => {
        setVision(next);
        setVisionDraft(next.description);
        setReferencesDraft(next.references.join("\n"));
      })
      .catch((error) => setVisionStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    const refreshSelection = () => {
      void scratchGet()
        .then((snapshot) => setSelectionLabel(selectionLabelFromSnapshot(snapshot)))
        .catch(() => {});
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; kind?: string } | null;
      if (data?.source !== "nia-canvas" || data.kind !== "nia:select") return;
      window.setTimeout(refreshSelection, 0);
    };
    window.addEventListener("nia:scratch-selection", refreshSelection);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("nia:scratch-selection", refreshSelection);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  function resetVisionDrafts(current: VisionContext) {
    setVisionDraft(current.description);
    setReferencesDraft(current.references.join("\n"));
  }

  async function saveVision() {
    if (!vision || !visionEditing) return;
    setVisionStatus("Saving...");
    try {
      const references = referencesDraft
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      const next = await visionSave(visionDraft, references);
      setVision(next);
      resetVisionDrafts(next);
      setVisionEditing(false);
      setVisionStatus("");
    } catch (error) {
      setVisionStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function runAgent() {
    const requestText = prompt.trim();
    if (!requestText || busy) return;

    setPrompt("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { role: "user", text: requestText, meta: null },
    ]);

    try {
      const response: ScratchAgentResponse = await scratchAgentRun({ prompt: requestText });
      setMessages(response.history);
      setSelectionLabel(null);
      window.dispatchEvent(new CustomEvent("nia:scratch-updated", {
        detail: {
          document: response.document,
          undoDepth: response.undoDepth,
          version: response.version,
        },
      }));
    } catch (error) {
      try {
        setMessages(await scratchAgentHistory());
      } catch {
        setMessages((current) => [
          ...current,
          { role: "error", text: error instanceof Error ? error.message : String(error), meta: null },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void runAgent();
    }
  }

  return (
    <div className="scratchAgentPanel">
      <div className="scratchVisionCard">
        <div className="scratchVisionHeader">
          <b>VISION CONTEXT</b>
          <button onClick={() => {
            if (visionEditing && vision) resetVisionDrafts(vision);
            setVisionEditing((current) => !current);
            setVisionStatus("");
          }}>{visionEditing ? "Cancel" : "Edit"}</button>
        </div>
        {visionEditing ? (
          <>
            <textarea
              value={visionDraft}
              onChange={(event) => setVisionDraft(event.target.value)}
              placeholder="Describe the visual direction for this project..."
            />
            <textarea
              className="scratchVisionReferences"
              value={referencesDraft}
              onChange={(event) => setReferencesDraft(event.target.value)}
              placeholder="Reference URLs or notes, one per line"
            />
            <div className="scratchVisionFooter">
              <small>{visionStatus || "Used automatically by Scratch agent runs"}</small>
              <button onClick={() => void saveVision()} disabled={!vision}>Save</button>
            </div>
          </>
        ) : (
          <>
            <p>{vision?.description || "Loading project vision..."}</p>
            <small>
              Project vision{vision ? ` · ${vision.references.length} refs · v${vision.version}` : ""}
            </small>
          </>
        )}
      </div>

      <div className="scratchAgentChat">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`scratchAgentMessage ${message.role}`}>
            <b>{message.role === "user" ? "You" : message.role === "error" ? "Error" : "Nia"}</b>
            <p>{message.text}</p>
            {message.meta ? <small>{message.meta}</small> : null}
          </div>
        ))}
        {busy ? <div className="scratchAgentWorking">Nia is editing Scratch...</div> : null}
      </div>

      <div className="scratchAgentComposer">
        <div className="scratchAgentChips">
          <span>Scratch</span>
          <span>{vision ? `Vision v${vision.version}` : "Vision"}</span>
          {selectionLabel ? <span>{selectionLabel}</span> : null}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Ask Nia to build or change the canvas..."
          disabled={busy}
        />
        <div className="scratchAgentSendRow">
          <span>{busy ? "Working" : "Cmd+Enter"}</span>
          <button disabled={busy || !prompt.trim()} onClick={() => void runAgent()}>↑</button>
        </div>
      </div>
    </div>
  );
}
