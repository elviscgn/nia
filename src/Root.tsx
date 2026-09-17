import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import App from "./App";
import ModelSettingsPanel from "./ModelSettingsPanel";
import ScratchAgentPanel from "./ScratchAgentPanel";
import { modelSettingsGet } from "./lib/model";

function modelButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".actions button"))
    .find((button) => button.textContent?.trim().startsWith("Model")) ?? null;
}

async function refreshModelLabel() {
  const button = modelButton();
  if (!button) return;
  try {
    const settings = await modelSettingsGet();
    button.textContent = settings.model ? `Model · ${settings.model}` : "Model · Setup";
  } catch {
    button.textContent = "Model · Setup";
  }
}

export default function Root() {
  const [agentHost, setAgentHost] = useState<HTMLElement | null>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);

  useEffect(() => {
    setAgentHost(document.querySelector<HTMLElement>(".agent"));
    void refreshModelLabel();

    const openModelSettings = () => setModelSettingsOpen(true);
    const onModelUpdated = () => void refreshModelLabel();
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) return;
      if (!target.closest(".actions")) return;
      if (!target.textContent?.trim().startsWith("Model")) return;
      setModelSettingsOpen(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelSettingsOpen(false);
    };

    window.addEventListener("nia:open-model-settings", openModelSettings);
    window.addEventListener("nia:model-settings-updated", onModelUpdated);
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("nia:open-model-settings", openModelSettings);
      window.removeEventListener("nia:model-settings-updated", onModelUpdated);
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <App />
      {agentHost ? createPortal(<ScratchAgentPanel />, agentHost) : null}
      {modelSettingsOpen ? <ModelSettingsPanel onClose={() => setModelSettingsOpen(false)} /> : null}
    </>
  );
}
