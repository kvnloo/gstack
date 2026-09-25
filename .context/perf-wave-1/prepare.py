"""Hash-pinned, fork-only activity experiment; no public API change."""
from pathlib import Path
import subprocess
p = Path('browse/src/activity.ts')
expected = 'b15eb45a1d1c2bf5ae57f832418a0d7aa40a0f52'
actual = subprocess.check_output(['git', 'hash-object', str(p)], text=True).strip()
if actual != expected:
    raise SystemExit(f'Source drift: {actual}; expected {expected}')
s = p.read_text()
Path('browse/src/.wave1-activity-baseline.ts').write_text(s)
old = '  const total = activityBuffer.totalAdded;\n  const allEntries = activityBuffer.toArray();'
new = '''  const total = activityBuffer.totalAdded;
  // IDs increase on every emission; a caught-up cursor needs no ring copy.
  const newest = activityBuffer.get(activityBuffer.length - 1);
  if (newest && afterId >= newest.id) {
    return { entries: [], gap: false, totalAdded: total };
  }
  const allEntries = activityBuffer.toArray();'''
if s.count(old) != 1:
    raise SystemExit('Cursor implementation changed')
s = s.replace(old, new)
start = s.index('export function getActivityHistory(')
end = s.index('\n/**', start)
block = s[start:end]
old = '  const allEntries = activityBuffer.toArray();'
new = '''  // Preserve legacy slice behavior for zero, negative and fractional limits.
  if (Number.isInteger(limit) && limit > 0) {
    return { entries: activityBuffer.last(limit), totalAdded: activityBuffer.totalAdded };
  }
  const allEntries = activityBuffer.toArray();'''
if block.count(old) != 1:
    raise SystemExit('History implementation changed')
block = block.replace(old, new)
s = s[:start] + block + s[end:]
p.write_text(s)
