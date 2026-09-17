import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import App from "./App";
import ScratchAgentPanel from "./ScratchAgentPanel";

export default function Root() {
  const [agentHost, setAgentHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setAgentHost(document.querySelector<HTMLElement>(".agent"));
  }, []);

  return (
    <>
      <App />
      {agentHost ? createPortal(<ScratchAgentPanel />, agentHost) : null}
    </>
  );
}
