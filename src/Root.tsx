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
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (target?.textContent?.trim() === "Model · Auto") {
        event.preventDefault();
        openModelSettings();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        openModelSettings();
      }
    };

    window.addEventListener("nia:open-model-settings", openModelSettings);
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("nia:open-model-settings", openModelSettings);
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
