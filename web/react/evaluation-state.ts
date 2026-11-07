import type { Appeal, Checklist, Evaluation } from './types';

export function hasAnswer(value:unknown):boolean {
  return value==='yes' || value==='no' || value==='na' || typeof value==='number' && Number.isFinite(value);
}

export function incompleteEvaluation(evaluation:Evaluation|null|undefined,checklist?:Checklist|null):boolean {
  if(!evaluation)return false;
  const criteria=Array.isArray(evaluation.criteria)?evaluation.criteria:[];
  return !Array.isArray(evaluation.criteria) || evaluation.complete===false || Array.isArray(evaluation.missing) && evaluation.missing.length>0
    || criteria.some(item=>!hasAnswer(item.answer))
    || Boolean(Array.isArray(checklist?.criteria) && checklist.criteria.some(definition=>!criteria.some(item=>item.criterion_id===definition.id)));
}

export function evaluationWasReviewed(evaluation:Evaluation,appeals:Appeal[]=[]):boolean {
  return appeals.some(appeal=>appeal.evaluation_id===evaluation.id && Boolean(appeal.decision))
    || typeof evaluation.original_total==='number' && Number.isFinite(evaluation.original_total) && evaluation.original_total!==evaluation.total
    || Array.isArray(evaluation.criteria) && evaluation.criteria.some(item=>item.original_answer!==undefined && item.original_answer!==item.answer);
}
