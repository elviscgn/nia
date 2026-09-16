# Spike checklist

Do not build the full agent until this passes.

## A — shell
- [ ] Tauri 3 alpha + official CEF opens on Apple Silicon
- [ ] React UI loads reliably
- [ ] hot reload works
- [ ] resizing/focus/keyboard shortcuts behave correctly
- [ ] DevTools works in development

## B — latency
- [ ] benchmark Rust IPC
- [ ] run background Rust work while dragging/resizing UI
- [ ] verify no renderer jank
- [ ] record cold and warm start

## C — canvas
- [ ] load a local Vite app in the Chromium canvas path
- [ ] receive DevTools Protocol events
- [ ] read DOM metadata
- [ ] draw selection overlay
- [ ] inspect computed styles

## D — source mapping
- [ ] selected DOM node resolves to component/source
- [ ] source path + line displayed in inspector
- [ ] deterministic style change edits source
- [ ] HMR updates canvas
- [ ] undo works

## E — agent
Only after A–D:
- [ ] one model provider
- [ ] streaming
- [ ] tiny tool set
- [ ] strict step budget
- [ ] cancellation
- [ ] progress events
- [ ] Vision + selection context
