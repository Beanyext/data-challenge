/** Compare saved DTOs only. No scores are calculated or persisted here. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
}

function savedChecklist(evaluation) {
  const checklist = evaluation.checklist;
  if (!object(checklist) || typeof evaluation.checklist_id !== 'string' || !evaluation.checklist_id
    || !Number.isInteger(evaluation.checklist_version) || checklist.id !== evaluation.checklist_id
    || checklist.version !== evaluation.checklist_version || !Array.isArray(checklist.criteria) || !checklist.criteria.length
    || checklist.criteria.some(item => !object(item) || typeof item.id !== 'string' || !item.id
      || typeof item.title !== 'string' || !['binary', 'scale'].includes(item.answer_type) || !finite(item.weight))
    || new Set(checklist.criteria.map(item => item.id)).size !== checklist.criteria.length) return null;
  const criteria = checklist.criteria.map(item => ({ id: item.id, title: item.title, description: item.description,
    code: item.code, section_id: item.section_id, answer_type: item.answer_type, weight: item.weight,
    scale: item.scale ?? null, na_allowed: item.na_allowed === true, gross_error: item.gross_error === true,
    na_rule: item.na_rule ?? null, notes: item.notes ?? null }));
  return { id: checklist.id, version: checklist.version, criteria,
    sections: checklist.sections ?? [], guidance: checklist.guidance ?? [], rounding: checklist.rounding ?? null };
}

function resultMap(evaluation, checklist) {
  if (!Array.isArray(evaluation.criteria)) return null;
  const known = new Set(checklist.criteria.map(item => item.id)), results = new Map();
  for (const item of evaluation.criteria) {
    if (!object(item) || !known.has(item.criterion_id) || results.has(item.criterion_id)) return null;
    if (item.evidence !== undefined && (!Array.isArray(item.evidence)
      || item.evidence.some(proof => !object(proof) || typeof proof.turn !== 'number'))) return null;
    if (item.checked_range != null && (!object(item.checked_range)
      || typeof item.checked_range.from !== 'number' || typeof item.checked_range.to !== 'number')) return null;
    if (item.decision != null && !object(item.decision)) return null;
    results.set(item.criterion_id, item);
  }
  return results;
}

function completeAnswer(item, criterion) {
  if (!item || item.needs_review || item.answer == null) return false;
  if (item.answer === 'na') return criterion.na_allowed && !criterion.gross_error;
  if (criterion.gross_error) return criterion.answer_type === 'binary' && ['yes', 'no'].includes(item.answer);
  if (item.applicable === false) return false;
  if (criterion.answer_type === 'binary') return ['yes', 'no'].includes(item.answer);
  if (!finite(item.answer)) return false;
  const steps = criterion.scale?.steps;
  return Array.isArray(steps) && steps.length ? steps.some(step => step.value === item.answer)
    : finite(criterion.scale?.max) && item.answer >= (criterion.scale.min ?? 0) && item.answer <= criterion.scale.max;
}

function displayState(item) {
  if (!item) return null;
  return { answer: item.answer ?? null, points: item.points ?? null, score: item.score ?? null,
    effective_weight: item.effective_weight ?? null, gross_error: item.gross_error === true,
    applicable: item.applicable !== false, needs_review: item.needs_review === true,
    explanation: item.explanation ?? '', na_reason: item.na_reason ?? '', review_reason: item.review_reason ?? '',
    evidence: item.evidence ?? [], checked_range: item.checked_range ?? null,
    decision: item.decision == null ? null : {answer: item.decision.answer ?? null, reason: item.decision.reason ?? '', status: item.decision.status ?? ''} };
}

export function compareEvaluations(before, after, { conversationId, beforeId, afterId } = {}) {
  const result = { error: null, rows: [], changedCount: 0, totalDelta: null,
    partialBefore: false, partialAfter: false, educational: false };
  const fail = error => ({ ...result, error });
  if (typeof conversationId !== 'string' || !conversationId || typeof beforeId !== 'string' || !beforeId
    || typeof afterId !== 'string' || !afterId || beforeId === afterId || !object(before) || !object(after)
    || before.id !== beforeId || after.id !== afterId
    || before.conversation_id !== conversationId || after.conversation_id !== conversationId) return fail('identity');
  const oldChecklist = savedChecklist(before), newChecklist = savedChecklist(after);
  if (!oldChecklist || !newChecklist) return fail('snapshot');
  if (oldChecklist.id !== newChecklist.id || oldChecklist.version !== newChecklist.version) return fail('version');
  if (stable(oldChecklist) !== stable(newChecklist)) return fail('snapshot');
  const oldResults = resultMap(before, oldChecklist), newResults = resultMap(after, newChecklist);
  if (!oldResults || !newResults) return fail('criteria');
  result.rows = before.checklist.criteria.map(criterion => {
    const oldItem = oldResults.get(criterion.id) ?? null, newItem = newResults.get(criterion.id) ?? null;
    return { criterion, before: oldItem, after: newItem, changed: stable(displayState(oldItem)) !== stable(displayState(newItem)) };
  });
  result.changedCount = result.rows.filter(row => row.changed).length;
  const partial = (evaluation, results, checklist) => evaluation.complete === false || Boolean(evaluation.missing?.length)
    || checklist.criteria.some(criterion => !completeAnswer(results.get(criterion.id), criterion));
  result.partialBefore = partial(before, oldResults, oldChecklist);
  result.partialAfter = partial(after, newResults, newChecklist);
  if (!result.partialBefore && !result.partialAfter && finite(before.total) && finite(after.total)) result.totalDelta = after.total - before.total;
  result.educational = [before, after].some(evaluation => evaluation.demo === true || ['mock', 'demo'].includes(evaluation.provider)
    || /^mock(?:$|[-:])/i.test(evaluation.model || ''));
  return result;
}
