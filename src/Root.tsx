import { useEffect, useState } from "react";
import App from "./App";
import ModelSettingsPanel from "./ModelSettingsPanel";
import ScratchAgentPanel from "./ScratchAgentPanel";
import { modelSettingsGet } from "./lib/model";

export default function Root() {
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelLabel, setModelLabel] = useState("Model · Setup");

  useEffect(() => {
    const refreshModelLabel = async () => {
      try {
        const settings = await modelSettingsGet();
        setModelLabel(settings.model ? `Model · ${settings.model}` : "Model · Setup");
      } catch {
        setModelLabel("Model · Setup");
      }
    };

    void refreshModelLabel();
    const onModelUpdated = () => void refreshModelLabel();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelSettingsOpen(false);
    };

    window.addEventListener("nia:model-settings-updated", onModelUpdated);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("nia:model-settings-updated", onModelUpdated);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <>
      <App
        agentPanel={<ScratchAgentPanel />}
        modelLabel={modelLabel}
        onOpenModelSettings={() => setModelSettingsOpen(true)}
      />
      {modelSettingsOpen ? <ModelSettingsPanel onClose={() => setModelSettingsOpen(false)} /> : null}
    </>
  );
}
