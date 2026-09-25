// Fork-only checks; the isolated process owns both module instances and probes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const load = p => import(pathToFileURL(resolve(p)).href);
const A = await load('browse/src/.wave1-activity-baseline.ts');
const B = await load('browse/src/activity.ts');
const { CircularBuffer } = await load('browse/src/buffers.ts');
let checks = 0;
const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
const limits = [undefined, -Infinity, -1001, -1, -0.5, 0, 0.5, 1, 1.5, 50, 999, 1000, 1001, Infinity, NaN];
function compare(count) {
  for (const limit of limits) equal(A.getActivityHistory(limit), B.getActivityHistory(limit));
  const oldest = Math.max(1, count - 999);
  for (const cursor of [-Infinity, -1, 0, 0.5, oldest - 1, oldest, oldest + 0.5, count - 1, count, count + 1, Infinity, NaN]) {
    equal(A.getActivityAfter(cursor), B.getActivityAfter(cursor));
  }
}
compare(0);
for (let i = 1; i <= 2500; i++) {
  const entry = { type: 'command_end', command: i % 2 ? 'type' : 'goto', args: ['synthetic-input'],
    result: 'x'.repeat(i % 240), status: 'ok', duration: i % 20 };
  const a = A.emitActivity(entry), b = B.emitActivity(entry);
  // Module instances have separate clocks; align only test-fixture timestamps.
  a.timestamp = b.timestamp;
  equal(a, b);
  if ([1, 2, 999, 1000, 1001, 2000, 2500].includes(i)) compare(i);
}
const seenA = [], seenB = [];
const stopA = A.subscribe(e => seenA.push(e.id));
const stopB = B.subscribe(e => seenB.push(e.id));
const a = A.emitActivity({ type: 'navigation', url: 'https://example.test/' });
const b = B.emitActivity({ type: 'navigation', url: 'https://example.test/' });
a.timestamp = b.timestamp;
await new Promise(resolve => queueMicrotask(resolve));
stopA(); stopB();
equal(seenA, seenB);
equal(seenA, [2501]);
compare(2501);

// Count actual full-ring copies, separately from timing. Restore immediately.
function copyProbe(fn) {
  const saved = CircularBuffer.prototype.toArray;
  let copies = 0;
  CircularBuffer.prototype.toArray = function (...args) { copies++; return saved.apply(this, args); };
  try { fn(); return copies; } finally { CircularBuffer.prototype.toArray = saved; }
}
const copyCounts = {
  baseline_caught_up: copyProbe(() => A.getActivityAfter(2501)),
  candidate_caught_up: copyProbe(() => B.getActivityAfter(2501)),
  baseline_history_50: copyProbe(() => A.getActivityHistory(50)),
  candidate_history_50: copyProbe(() => B.getActivityHistory(50)),
};
equal(copyCounts, { baseline_caught_up: 1, candidate_caught_up: 0, baseline_history_50: 1, candidate_history_50: 0 });
let sink = 0;
function bench(name, callA, callB) {
  for (let i = 0; i < 500; i++) { sink += callA(); sink += callB(); }
  const iterations = 10000;
  const raw = [];
  for (let block = 0; block < 8; block++) {
    const order = block % 2 ? ['B', 'A', 'A', 'B'] : ['A', 'B', 'B', 'A'];
    for (const variant of order) {
      const fn = variant === 'A' ? callA : callB;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) sink += fn();
      raw.push({ block, variant, total_ms: performance.now() - start });
    }
  }
  const median = variant => {
    const v = raw.filter(x => x.variant === variant).map(x => x.total_ms / iterations).sort((a,b) => a-b);
    return (v[7] + v[8]) / 2;
  };
  return { name, iterations, A_median_ms_per_call: median('A'), B_median_ms_per_call: median('B'), raw };
}
const profiles = [
  bench('caught-up-cursor', () => A.getActivityAfter(2501).entries.length, () => B.getActivityAfter(2501).entries.length),
  bench('history-50', () => A.getActivityHistory(50).entries.length, () => B.getActivityHistory(50).entries.length),
  bench('gap-replay-control', () => A.getActivityAfter(1).entries.length, () => B.getActivityAfter(1).entries.length),
  bench('legacy-zero-control', () => A.getActivityHistory(0).entries.length, () => B.getActivityHistory(0).entries.length),
];
const ids = A.getActivityHistory(1000).entries.map(e => e.id);
const report = { runtime: process.versions, semantic_checks: checks, copy_counts: copyCounts,
  event_id_sha256: createHash('sha256').update(JSON.stringify(ids)).digest('hex'), sink, profiles,
  limitations: ['Synthetic module-level experiment; not HTTP/SSE or a browser UI benchmark.',
    'Existing entry ID monotonicity is assumed, as established by emitActivity.',
    'No cursor gap policy, zero-limit behavior, privacy filtering or subscriber scheduling changes.',
    'Full free suite, real browser, other platforms and long-lived server throughput remain separate gates.',
    'No flaky timing gate; raw sample/control inspection is required before promotion.'] };
writeFileSync('evidence/activity.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ semantic_checks: checks, copy_counts: copyCounts, profiles: profiles.map(({raw, ...p}) => p) }, null, 2));
