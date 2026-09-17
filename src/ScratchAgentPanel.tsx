import { useEffect, useState, type KeyboardEvent } from "react";
import { parseCanvasMessage, type CanvasSelection } from "./lib/canvas";
import { scratchAgentRun, type ScratchAgentResponse } from "./lib/agent";
import "./scratch-agent.css";

const CHAT_KEY = "nia:scratch-agent-chat:v1";

type ChatEntry = {
  role: "user" | "assistant" | "error";
  text: string;
  meta?: string;
};

function loadChat(): ChatEntry[] {
  try {
    const raw = window.localStorage.getItem(CHAT_KEY);
    if (!raw) return [{ role: "assistant", text: "Describe what you want to build or change in Scratch." }];
    const parsed = JSON.parse(raw) as ChatEntry[];
    return Array.isArray(parsed) && parsed.length
      ? parsed
      : [{ role: "assistant", text: "Describe what you want to build or change in Scratch." }];
  } catch {
    return [{ role: "assistant", text: "Describe what you want to build or change in Scratch." }];
  }
}

export default function ScratchAgentPanel() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<CanvasSelection | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>(() => loadChat());

  useEffect(() => {
    window.localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-80)));
  }, [messages]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = parseCanvasMessage(event);
      if (message?.kind !== "nia:select") return;
      if (message.selection.sourceUrl !== "scratch://index.html") return;
      setSelection(message.selection);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function runAgent() {
    const requestText = prompt.trim();
    if (!requestText || busy) return;

    setPrompt("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text: requestText }]);

    try {
      const response: ScratchAgentResponse = await scratchAgentRun({ prompt: requestText });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: response.summary || "Updated Scratch.",
          meta: `${response.model} · ${response.latencyMs} ms`,
        },
      ]);
      window.dispatchEvent(new CustomEvent("nia:scratch-updated", {
        detail: {
          document: response.document,
          undoDepth: response.undoDepth,
          version: response.version,
        },
      }));
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "error", text: error instanceof Error ? error.message : String(error) },
      ]);
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

  const selectionLabel = selection
    ? `${selection.tag}${selection.id ? `#${selection.id}` : ""}${selection.classes[0] ? `.${selection.classes[0]}` : ""}`
    : null;

  return (
    <div className="scratchAgentPanel">
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
          <span>Vision</span>
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
