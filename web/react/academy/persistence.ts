import type { AcademyState, Attempt } from './types';

const orderedUnion = (left: string[], right: string[]): string[] => [...new Set([...left, ...right])].sort();
const compareId = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const compareAttempts = (left: Attempt, right: Attempt): number => Date.parse(left.finishedAt) - Date.parse(right.finishedAt) || compareId(left.id, right.id);

function maximumRecords(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const id of orderedUnion(Object.keys(left), Object.keys(right))) {
    merged[id] = Math.max(left[id] ?? 0, right[id] ?? 0);
  }
  return merged;
}

function earliestAwards(left: Record<string, string>, right: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const id of orderedUnion(Object.keys(left), Object.keys(right))) {
    const candidates = [left[id], right[id]]
      .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
      .sort((a, b) => Date.parse(a) - Date.parse(b) || compareId(a, b));
    if (candidates.length) merged[id] = candidates[0];
  }
  return merged;
}

/**
 * Reconcile two already validated broker profiles without adding XP twice.
 * Persisted records win when the same attempt appears in both snapshots.
 * Local-only receipts can claim only the contribution not already persisted;
 * their dialogue and evaluation remain unchanged during offline recovery.
 * History remains oldest-to-newest, as required by completeSession and the UI.
 * A tab keeps its own active conversation and presentation preferences.
 */
export function mergeProgress(local: AcademyState, stored: AcademyState): AcademyState {
  const contributions = maximumRecords(local.contributions, stored.contributions);
  const remaining: Record<string, number> = {};
  for (const [missionId, total] of Object.entries(contributions)) remaining[missionId] = Math.max(0, total - (stored.contributions[missionId] ?? 0));
  const attempts = new Map(stored.history.map(attempt => [attempt.id, attempt]));
  for (const attempt of [...local.history].sort(compareAttempts)) {
    if (attempts.has(attempt.id)) continue;
    const available = remaining[attempt.missionId] ?? 0;
    const xpEarned = Math.min(attempt.xpEarned, available);
    remaining[attempt.missionId] = available - xpEarned;
    attempts.set(attempt.id, xpEarned === attempt.xpEarned ? attempt : { ...attempt, xpEarned });
  }
  const history = [...attempts.values()]
    .sort(compareAttempts)
    .slice(-50);
  return {
    version: local.version,
    dataset: local.dataset,
    contributions,
    best: maximumRecords(local.best, stored.best),
    mastered: orderedUnion(local.mastered, stored.mastered),
    awards: earliestAwards(local.awards, stored.awards),
    completedDays: orderedUnion(local.completedDays, stored.completedDays),
    history,
    active: local.active,
    demoUnlocked: local.demoUnlocked,
  };
}
