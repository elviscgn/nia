import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import App from "./App";
import ModelSettingsPanel from "./ModelSettingsPanel";
import ScratchAgentPanel from "./ScratchAgentPanel";

export default function Root() {
  const [agentHost, setAgentHost] = useState<HTMLElement | null>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);

  useEffect(() => {
    setAgentHost(document.querySelector<HTMLElement>(".agent"));

    const openModelSettings = () => setModelSettingsOpen(true);
    window.addEventListener("nia:open-model-settings", openModelSettings);
    return () => window.removeEventListener("nia:open-model-settings", openModelSettings);
  }, []);

  return (
    <>
      <App />
      {agentHost ? createPortal(<ScratchAgentPanel />, agentHost) : null}
      {modelSettingsOpen ? <ModelSettingsPanel onClose={() => setModelSettingsOpen(false)} /> : null}
    </>
  );
}
