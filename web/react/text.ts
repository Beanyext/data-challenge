// Text helpers for server-provided explanations. They only reshape text for display, never change answers or scores.
import type { CriterionResult, FragmentTurn, Turn } from './types';

/** Turn references in explanations: «[10]» is message № 10 in the transcript (index 9). */
export const TURN_REFERENCE = /\[(\d+)\]/g;
const BASIS_TAIL = /\s*Основание\s*[—–-][\s\S]*$/;
const LEAD = /^[^—.]{0,120}—\s*[^.]{0,40}\.\s*/;

/** Same rule as the server's short reason: no «Title — answer.» lead, no «Основание — …» tail, one sentence. */
export function shortReason(explanation?: string | null, title?: string | null): string {
  const full = String(explanation ?? '').trim();
  let text = full;
  if (title && text.toLowerCase().startsWith(String(title).toLowerCase().slice(0, 12))) text = text.replace(LEAD, '');
  text = text.replace(BASIS_TAIL, '').trim() || full;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let out = sentences[0] ?? '';
  if (out.length < 40 && sentences.length > 1) out = `${out} ${sentences[1]}`;
  return out.slice(0, 280);
}

export function criterionReason(item: CriterionResult, title?: string | null): string {
  const given = typeof item.reason === 'string' ? item.reason.trim() : '';
  if (given) return given;
  return shortReason(item.answer === 'na' && item.na_reason ? item.na_reason : item.explanation, title ?? item.title);
}

/** Printable form of turn references: «[10]» becomes «№ 10». */
export const plainTurnRefs = (text?: string | null) => String(text ?? '').replace(TURN_REFERENCE, (_match, n: string) => `№ ${Number(n)}`);

export function formatDuration(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export const turnTime = (turn: Turn | FragmentTurn) => turn.display_time || turn.timestamp || '';

export type ScoreTone = 'high' | 'mid' | 'low';
export function scoreTone(total: unknown): ScoreTone | null {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  return total >= 85 ? 'high' : total >= 60 ? 'mid' : 'low';
}

/** First place to look at for a criterion: first valid evidence turn, otherwise the start of the checked range. */
export function firstTurn(item: CriterionResult, transcriptLength: number): number | null {
  const valid = (turn: unknown): turn is number => typeof turn === 'number' && Number.isInteger(turn) && turn >= 0 && turn < transcriptLength;
  const evidence = Array.isArray(item.evidence) ? item.evidence.find(entry => valid(entry?.turn)) : undefined;
  if (evidence) return evidence.turn;
  const range = item.checked_range;
  return range && valid(range.from) && valid(range.to) && range.to >= range.from ? range.from : null;
}
