import { dayKey } from './engine';
import { missions } from './missions';
import type { Attempt } from './types';

export const WEEKLY_PLAN_KEY = 'freedom-academy:broker:weekly-plan:v1';
export interface PlannedMission { date: string; missionId: string }
export interface WeeklyPlanData { version: 1; entries: PlannedMission[] }
export type PlanWarning = 'unavailable' | 'corrupt' | 'incompatible';
const missionIds = new Set(missions.map(mission => mission.id));
const MAX_ENTRIES = 1000;
const DAY = 86_400_000;
export const emptyWeeklyPlan = (): WeeklyPlanData => ({ version: 1, entries: [] });
export function validPlanDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function shiftPlanDate(date: string, days: number): string {
  if (!validPlanDate(date) || !Number.isInteger(days)) throw new Error('invalid-plan-date');
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  if (!validPlanDate(next)) throw new Error('invalid-plan-date');
  return next;
}
export function weekDates(date = dayKey()): string[] {
  if (!validPlanDate(date)) throw new Error('invalid-plan-date');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = shiftPlanDate(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftPlanDate(monday, index));
}
const sorted = (entries: PlannedMission[]) => [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.missionId.localeCompare(b.missionId));
export function scheduleMission(plan: WeeklyPlanData, date: string, missionId: string, available: ReadonlySet<string>): WeeklyPlanData {
  if (!validPlanDate(date) || !missionIds.has(missionId) || !available.has(missionId)) return plan;
  if (plan.entries.length >= MAX_ENTRIES || plan.entries.some(entry => entry.date === date && entry.missionId === missionId)) return plan;
  return { version: 1, entries: sorted([...plan.entries, { date, missionId }]) };
}
export function removePlannedMission(plan: WeeklyPlanData, date: string, missionId: string): WeeklyPlanData {
  const entries = plan.entries.filter(entry => entry.date !== date || entry.missionId !== missionId);
  return entries.length === plan.entries.length ? plan : { version: 1, entries };
}
export function movePlannedMission(plan: WeeklyPlanData, from: string, to: string, missionId: string, available: ReadonlySet<string>): WeeklyPlanData {
  if (from === to || !validPlanDate(to) || !available.has(missionId) || !missionIds.has(missionId) || !plan.entries.some(entry => entry.date === from && entry.missionId === missionId)) return plan;
  const without = removePlannedMission(plan, from, missionId);
  // Moving onto an existing slot merges the duplicate without adding a second entry.
  return scheduleMission(without, to, missionId, available);
}
export function plannedCompletion(entry: PlannedMission, history: readonly Pick<Attempt, 'missionId' | 'finishedAt' | 'passed'>[]): { status: 'planned' | 'completed' | 'passed'; count: number } {
  const matching = history.filter(attempt => attempt.missionId === entry.missionId && Number.isFinite(Date.parse(attempt.finishedAt)) && dayKey(new Date(attempt.finishedAt)) === entry.date);
  return { status: matching.some(attempt => attempt.passed) ? 'passed' : matching.length ? 'completed' : 'planned', count: matching.length };
}

function validate(value: unknown): { plan?: WeeklyPlanData; warning?: PlanWarning } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { warning: 'corrupt' };
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return { warning: 'incompatible' };
  if (!Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES) return { warning: 'corrupt' };
  const entries: PlannedMission[] = [];
  const seen = new Set<string>();
  for (const item of raw.entries) {
    if (!item || typeof item !== 'object' || !validPlanDate(item.date) || typeof item.missionId !== 'string' || !missionIds.has(item.missionId)) return { warning: 'corrupt' };
    const id = `${item.date}:${item.missionId}`;
    if (!seen.has(id)) { entries.push({ date: item.date, missionId: item.missionId }); seen.add(id); }
  }
  return { plan: { version: 1, entries: sorted(entries) } };
}
export function readWeeklyPlan(storage?: Pick<Storage, 'getItem'>): { plan: WeeklyPlanData; warning?: PlanWarning } {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(WEEKLY_PLAN_KEY);
    if (raw === null) return { plan: emptyWeeklyPlan() };
    if (raw.length > 100_000) return { plan: emptyWeeklyPlan(), warning: 'corrupt' };
    const result = validate(JSON.parse(raw));
    return { plan: result.plan ?? emptyWeeklyPlan(), warning: result.warning };
  } catch (error) {
    return { plan: emptyWeeklyPlan(), warning: error instanceof SyntaxError ? 'corrupt' : 'unavailable' };
  }
}
export function writeWeeklyPlan(plan: WeeklyPlanData, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const clean = validate(plan).plan;
    if (!clean) return false;
    (storage ?? globalThis.localStorage).setItem(WEEKLY_PLAN_KEY, JSON.stringify(clean));
    return true;
  } catch { return false; }
}

let cached: { plan: WeeklyPlanData; warning?: PlanWarning } | undefined;
let dirty = false;
export function currentWeeklyPlan(): { plan: WeeklyPlanData; warning?: PlanWarning } {
  cached ??= readWeeklyPlan();
  return cached;
}
export function rememberWeeklyPlan(plan: WeeklyPlanData): { plan: WeeklyPlanData; warning?: PlanWarning } {
  const clean = validate(plan).plan;
  if (!clean) return currentWeeklyPlan();
  const saved = writeWeeklyPlan(clean);
  dirty = !saved;
  cached = { plan: clean, warning: saved ? undefined : 'unavailable' };
  return cached;
}
/** Optional integration into the existing before-reload guard; never touches progress. */
export function retryPendingWeeklyPlanSave(): boolean {
  if (!dirty || !cached) return true;
  return !rememberWeeklyPlan(cached.plan).warning;
}
