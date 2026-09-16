# Nia — Architecture Spike 0

Goal: prove the stack before building the full product.

- Tauri 3
- official CEF/Chromium runtime
- React + TypeScript UI
- Rust + Tokio core
- fast Rust ↔ UI round trips
- Chromium canvas path
- performance instrumentation from day one

This spike pins Tauri `3.0.0-alpha.1` + `tauri-runtime-cef 3.0.0-alpha.1` because the official CEF runtime is brand new and moving quickly.

## Run

```bash
pnpm install
pnpm tauri dev
```

## What we prove first

1. App opens reliably with CEF.
2. UI remains smooth while Rust performs background work.
3. Rust ↔ frontend command round trips stay tiny.
4. A local Vite preview can run in the Chromium canvas path.
5. DevTools Protocol events can be received from CEF.
6. Selection → source mapping can be prototyped.
7. HMR remains fast and stable.

See `docs/SPIKE_CHECKLIST.md`.
