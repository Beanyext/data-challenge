/** Read-only aggregation of the latest saved evaluation per conversation. No dialog text is copied. */
const finite = value => typeof value === 'number' && Number.isFinite(value);
const excludedStatuses = new Set(['new', 'pending', 'queued', 'running', 'error', 'failed']);
export const analyticsLanguage = value => {
  const language = String(value || '').toUpperCase();
  return language === 'KK' ? 'KZ' : ['RU', 'EN', 'KZ'].includes(language) ? language : 'other';
};
export const analyticsGroupKey = (id, version) => JSON.stringify([id, version]);

function snapshot(evaluation) {
  const checklist = evaluation.checklist;
  if (!checklist || typeof evaluation.checklist_id !== 'string' || !Number.isInteger(evaluation.checklist_version)
    || checklist.id !== evaluation.checklist_id || checklist.version !== evaluation.checklist_version
    || !Array.isArray(checklist.criteria) || !checklist.criteria.length || checklist.criteria.some(item => !item || typeof item !== 'object')) return null;
  const criteria = checklist.criteria.map(item => ({ id: item.id, title: item.title, code: item.code, description: item.description,
    section_id: item.section_id, notes: item.notes, na_rule: item.na_rule,
    answer_type: item.answer_type, weight: item.weight, gross_error: item.gross_error === true,
    scale: item.scale ? { min: item.scale.min, max: item.scale.max, steps: item.scale.steps } : null,
    na_allowed: item.na_allowed === true }));
  if (criteria.some(item => typeof item.id !== 'string' || typeof item.title !== 'string')
    || new Set(criteria.map(item => item.id)).size !== criteria.length) return null;
  return { id: checklist.id, version: checklist.version, name: checklist.name || checklist.id, criteria, guidance: checklist.guidance, sections: checklist.sections, rounding: checklist.rounding };
}

export async function loadAnalytics(rows, getEvaluation, { concurrency = 4 } = {}) {
  const skipped = { unevaluated: 0, pending: 0, error: 0 };
  // Freeze IDs before asynchronous reads, rather than following a newer row midway through the run.
  const candidates = [];
  for (const row of rows) {
    const status = row.status || '';
    if (excludedStatuses.has(status) || !row.evaluation_id) {
      skipped[['error', 'failed'].includes(status) ? 'error' : ['pending', 'queued', 'running'].includes(status) ? 'pending' : 'unevaluated']++;
      continue;
    }
    candidates.push({ conversationId: row.conversation_id, evaluationId: row.evaluation_id, language: analyticsLanguage(row.language) });
  }
  const failures = { request: 0, identity: 0, snapshot: 0, conflict: 0 };
  const loaded = new Array(candidates.length);
  let next = 0;
  const workers = Math.max(1, Math.min(4, Number.isFinite(concurrency) ? Math.floor(concurrency) : 4, candidates.length || 1));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < candidates.length) {
      const index = next++;
      const candidate = candidates[index];
      let evaluation;
      try { evaluation = await getEvaluation(candidate.evaluationId); } catch { failures.request++; continue; }
      if (!evaluation || evaluation.id !== candidate.evaluationId || evaluation.conversation_id !== candidate.conversationId) { failures.identity++; continue; }
      const checklist = snapshot(evaluation);
      if (!checklist || !Array.isArray(evaluation.criteria) || evaluation.criteria.some(item => !item || typeof item !== 'object')) { failures.snapshot++; continue; }
      const criteria = evaluation.criteria.map(item => ({ criterion_id: item.criterion_id, answer: item.answer,
        applicable: item.applicable, gross_error: item.gross_error, needs_review: item.needs_review,
        points: item.points, effective_weight: item.effective_weight }));
      const complete = evaluation.complete !== false && !evaluation.missing?.length && checklist.criteria.every(criterion => {
        const matches = criteria.filter(item => item.criterion_id === criterion.id);
        if (matches.length !== 1 || matches[0].needs_review) return false;
        const item = matches[0];
        return item.answer === 'na' ? criterion.na_allowed && !criterion.gross_error
          : item.applicable !== false && validAnswer(item.answer, criterion);
      });
      loaded[index] = { ...candidate, checklist, key: analyticsGroupKey(checklist.id, checklist.version), criteria,
        total: finite(evaluation.total) ? evaluation.total : null, complete,
        gross_error: evaluation.gross_error === true,
        educational: evaluation.demo === true || ['mock', 'demo'].includes(evaluation.provider) || /^mock(?:$|[-:])/i.test(evaluation.model || '') };
    }
  }));
  const signatures = new Map();
  const conflicts = new Set();
  for (const record of loaded.filter(Boolean)) {
    const signature = JSON.stringify(record.checklist);
    if (signatures.has(record.key) && signatures.get(record.key) !== signature) conflicts.add(record.key);
    else signatures.set(record.key, signature);
  }
  const records = loaded.filter(Boolean).filter(record => {
    if (conflicts.has(record.key)) { failures.conflict++; return false; }
    return true;
  });
  const groups = [...new Map(records.map(record => [record.key, { key: record.key, ...record.checklist }])).values()];
  return { records, groups, failures, skipped, total: rows.length, requested: candidates.length };
}

function validAnswer(answer, criterion) {
  if (criterion.answer_type === 'binary') return answer === 'yes' || answer === 'no';
  if (criterion.answer_type !== 'scale' || !finite(answer)) return false;
  const steps = criterion.scale?.steps;
  return Array.isArray(steps) && steps.length ? steps.some(step => step.value === answer)
    : finite(criterion.scale?.max) && answer >= (criterion.scale.min ?? 0) && answer <= criterion.scale.max;
}

export function summarizeAnalytics(data, key, language = '') {
  const group = data.groups.find(item => item.key === key);
  const records = data.records.filter(item => item.key === key && (!language || item.language === language));
  const totals = records.filter(item => item.complete && finite(item.total));
  const criteria = (group?.criteria || []).map(criterion => {
    const result = { id: criterion.id, title: criterion.title, code: criterion.code || criterion.id,
      gross: criterion.gross_error, valid: 0, na: 0, unknown: 0, losses: 0, lostPoints: 0,
      grossCount: 0, lossRate: null, averageLoss: null, dialogIds: [] };
    for (const record of records) {
      const matches = record.criteria.filter(item => item.criterion_id === criterion.id);
      const item = matches.length === 1 ? matches[0] : null;
      if (!item || item.needs_review || item.answer == null) { result.unknown++; continue; }
      if (item.answer === 'na' && criterion.na_allowed && !criterion.gross_error) { result.na++; continue; }
      if (item.applicable === false || !validAnswer(item.answer, criterion)) { result.unknown++; continue; }
      if (criterion.gross_error) {
        result.valid++;
        if (item.answer === 'yes') { result.grossCount++; result.dialogIds.push(record.conversationId); }
        continue;
      }
      if (!finite(item.points) || !finite(item.effective_weight) || item.effective_weight < 0
        || item.points < 0 || item.points > item.effective_weight + .011) { result.unknown++; continue; }
      result.valid++;
      const loss = Math.max(0, item.effective_weight - item.points);
      result.lostPoints += loss;
      if (loss > .005) { result.losses++; result.dialogIds.push(record.conversationId); }
    }
    if (result.valid) {
      result.lossRate = (result.gross ? result.grossCount : result.losses) / result.valid;
      if (!result.gross) result.averageLoss = result.lostPoints / result.valid;
    }
    return result;
  });
  return { records: records.length, average: totals.length ? totals.reduce((sum, item) => sum + item.total, 0) / totals.length : null,
    scored: totals.length, gross: records.filter(item => item.gross_error).length, criteria };
}
