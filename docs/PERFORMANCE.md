# Nia performance contract

Nia is latency-first.

- Never show an unexplained frozen state.
- Deterministic visual edits should not call a model.
- Keep dev servers and browser processes warm.
- Preload context when the user selects an element.
- Parallelize independent reads.
- Truncate noisy tool output.
- Cancel stalled tools.
- Detect repeated or no-progress actions.
- Prefer small, high-signal model contexts.

Initial engineering targets:

| Interaction | Target |
|---|---:|
| UI input response | < 16 ms |
| Rust IPC round trip | < 5 ms local median |
| selection overlay | < 50 ms |
| DOM to known source lookup | < 100 ms warm |
| deterministic style patch | < 100 ms before HMR |
| typical HMR | < 1 s |
| visible agent activity | < 500 ms |
| fast agent task | 2 to 10 s typical |
