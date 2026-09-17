import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import App from "./App";
import ScratchAgentPanel from "./ScratchAgentPanel";

export default function Root() {
  const [appVersion, setAppVersion] = useState(0);
  const [agentHost, setAgentHost] = useState<HTMLElement | null>(null);
  const reopenScratch = useRef(false);

  useEffect(() => {
    const host = document.querySelector<HTMLElement>(".agent");
    setAgentHost(host);

    if (!reopenScratch.current) return;
    reopenScratch.current = false;
    window.requestAnimationFrame(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".canvasToolbar button"));
      const scratchButton = buttons.find((button) => button.textContent?.trim() === "Scratch");
      scratchButton?.click();
    });
  }, [appVersion]);

  const applyAgentDocument = () => {
    reopenScratch.current = true;
    setAgentHost(null);
    setAppVersion((version) => version + 1);
  };

  return (
    <>
      <App key={appVersion} />
      {agentHost ? createPortal(<ScratchAgentPanel onApplied={applyAgentDocument} />, agentHost) : null}
    </>
  );
}
