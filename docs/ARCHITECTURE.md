# Nia architecture

## React / TypeScript
Owns the workspace UI, inspector, canvas overlays, keyboard/mouse interactions, and browser-side instrumentation.

## Rust / Tokio
Owns the agent runtime, model routing, context construction, repo indexing, filesystem, file watching, Git, PTYs, process supervision, source transforms, SQLite, caching, cancellation/timeouts, and anti-loop logic.

## CEF / Chromium
Owns Chromium rendering, DevTools Protocol, console/network/page events, screenshots, and frontend preview.

## Rule
Anything that can stall the UI does not run on the UI thread. Nia may consume memory aggressively if that reduces user-visible latency.
