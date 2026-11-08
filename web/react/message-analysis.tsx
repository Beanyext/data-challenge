import type { CriterionResult, Evaluation } from './types';
import { TURN_REFERENCE } from './text';

export const validMessageIndex = (index: unknown, length: number): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < length;
export function validCheckedRange(item: CriterionResult, length: number) {
  const range = item.checked_range;
  return range && validMessageIndex(range.from, length) && validMessageIndex(range.to, length) && range.from <= range.to ? range : null;
}

export type MessageCriterionLink = { item: CriterionResult; kind: 'evidence' | 'reference' | 'range' };
/** References in model prose are 1-based; structured evidence and inclusive ranges are 0-based. */
export function linkedMessageCriteria(evaluation: Evaluation | null, index: number, length: number): MessageCriterionLink[] {
  if (!evaluation || !validMessageIndex(index, length)) return [];
  return (Array.isArray(evaluation.criteria) ? evaluation.criteria : []).flatMap((item): MessageCriterionLink[] => {
    if (Array.isArray(item.evidence) && item.evidence.some(entry => entry && validMessageIndex(entry.turn, length) && entry.turn === index)) return [{ item, kind: 'evidence' as const }];
    if ([item.explanation, item.reason, item.na_reason].some(text => typeof text === 'string' && [...text.matchAll(TURN_REFERENCE)].some(match => Number(match[1]) === index + 1))) return [{ item, kind: 'reference' as const }];
    const range = validCheckedRange(item, length);
    return range && index >= range.from && index <= range.to ? [{ item, kind: 'range' as const }] : [];
  });
}
