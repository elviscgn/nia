import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Serves the tiny sample app that Nia loads inside its central canvas.
// Runs on its own port so the canvas page is isolated from the Nia shell.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  root: "sample",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
});
