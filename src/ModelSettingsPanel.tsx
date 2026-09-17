import { useEffect, useState } from "react";
import {
  modelSettingsGet,
  modelSettingsSave,
  modelTestConnection,
  type ModelSettings,
} from "./lib/model";
import "./model-settings.css";

type Props = {
  onClose: () => void;
};

function announceModelUpdate() {
  window.dispatchEvent(new CustomEvent("nia:model-settings-updated"));
}

export default function ModelSettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("Loading model settings...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    modelSettingsGet()
      .then((next) => {
        setSettings(next);
        setBaseUrl(next.baseUrl);
        setModel(next.model);
        setStatus(next.baseUrl && next.model ? `Loaded from ${next.source}` : "No model configured yet");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, []);

  async function save() {
    if (busy) return;
    setBusy(true);
    setStatus("Saving...");
    try {
      const next = await modelSettingsSave(baseUrl, model, apiKey.trim() ? apiKey : null);
      setSettings(next);
      setApiKey("");
      setStatus("Saved in Rust core");
      announceModelUpdate();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (busy) return;
    setBusy(true);
    setStatus("Testing connection...");
    try {
      if (baseUrl !== settings?.baseUrl || model !== settings?.model || apiKey.trim()) {
        const next = await modelSettingsSave(baseUrl, model, apiKey.trim() ? apiKey : null);
        setSettings(next);
        setApiKey("");
        announceModelUpdate();
      }
      const result = await modelTestConnection();
      setStatus(`Connected to ${result.model} in ${result.latencyMs} ms`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modelSettingsBackdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modelSettingsPanel" role="dialog" aria-modal="true" aria-label="Model settings">
        <header>
          <div>
            <small>SETTINGS</small>
            <h2>Models</h2>
          </div>
          <button onClick={onClose} aria-label="Close model settings">×</button>
        </header>

        <label>
          <span>Base URL</span>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://127.0.0.1:1234/v1"
            autoFocus
          />
        </label>

        <label>
          <span>Model</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="qwen3-coder"
          />
        </label>

        <label>
          <span>API key</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={settings?.hasApiKey ? "Configured, leave blank to keep" : "Optional for local providers"}
            type="password"
          />
          <small>The key stays in Rust memory for this session. Base URL and model persist on disk.</small>
        </label>

        <div className="modelSettingsStatus">{status}</div>

        <footer>
          <button onClick={test} disabled={busy || !baseUrl.trim() || !model.trim()}>Test Connection</button>
          <button className="primary" onClick={save} disabled={busy || !baseUrl.trim() || !model.trim()}>Save</button>
        </footer>
      </section>
    </div>
  );
}
