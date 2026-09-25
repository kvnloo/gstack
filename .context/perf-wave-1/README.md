# Activity performance experiment — wave 1

Base: `730a1017d1a15a8c0c214b820b3865b6e2a32547`. AI-assisted, fork-only. The existing autoplan PR is not changed by this branch.

`getActivityAfter` currently copies the whole 1,000-entry ring even when the caller is caught up. `getActivityHistory(50)` copies the whole ring before slicing. The candidate returns an empty response without copying when the cursor is current/future, and reuses `CircularBuffer.last` for positive integer history limits. Legacy fallback is deliberately retained for zero, negative, fractional and non-finite limits.

Acceptance: differential results before fill, at capacity, after multiple wraps; cursor gaps and unusual limits; unchanged emitted events/subscriber delivery; actual full-copy counts 1 -> 0 on the two optimized paths; alternating ABBA raw measurements with gap-replay and zero-limit controls; native activity tests before/after. HTTP/SSE, browser integration and the full free suite remain separate gates.

## Design questions — draft, not posted upstream

- Would using the ring's existing tail reader for positive integer history limits be welcome, while leaving unusual limits unchanged in this performance-only patch?
- Should the `limit=0` and oldest-cursor boundary contracts be clarified separately? Changing them while optimizing would make behavioral and performance evidence harder to separate.
- Before changing live subscriber scheduling, what observable backpressure/latency target should govern it? Avoiding copies is independent of dropping/coalescing events; this wave never drops events.

Dependency: read/confirm activity contract -> differential/copy probes -> native tests + measurements -> inspect raw controls -> optional focused upstream proposal -> full acceptance. No new caching, limits, public commands, provider calls or default configuration.
