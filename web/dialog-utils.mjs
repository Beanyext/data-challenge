const completedStates = new Set(['completed', 'done', 'evaluated']);

export function dialogTitle(row) {
  return row.title || row.subject || row.transcript?.find(turn => turn.speaker === 'client')?.text || 'Диалог поддержки';
}

export function hasEvaluation(row) {
  return Boolean(row.evaluation_id) || completedStates.has(row.status) || Number.isFinite(row.total);
}

export function evaluationChecklist(evaluation, checklists = []) {
  if (!evaluation || evaluation.checklist_id == null || evaluation.checklist_version == null) return null;
  const matches = checklist => checklist && checklist.id === evaluation.checklist_id
    && String(checklist.version) === String(evaluation.checklist_version) && Array.isArray(checklist.criteria);
  if (matches(evaluation.checklist)) return evaluation.checklist;
  return checklists.find(matches) || null;
}

export function attentionReasons(row, appeals = []) {
  const reasons = [];
  if (row.gross_error) reasons.push('gross');
  if (row.needs_review || (Array.isArray(row.criteria) && row.criteria.some(item => item.needs_review))) reasons.push('review');
  if (appeals.some(appeal => appeal.status === 'open' && (
    appeal.conversation_id === row.conversation_id || Boolean(row.evaluation_id && appeal.evaluation_id === row.evaluation_id)
  ))) reasons.push('appeal');
  return reasons;
}

export function filterDialogs(rows, filters = {}, appeals = []) {
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  const filtered = rows.filter(row => {
    const reasons = attentionReasons(row, appeals);
    if (filters.queue === 'attention' && reasons.length === 0) return false;
    if (filters.language && row.language !== filters.language) return false;
    if (filters.channel && row.channel !== filters.channel) return false;
    if (query && !`${row.conversation_id} ${dialogTitle(row)} ${(row.transcript || []).map(turn => turn.text).join(' ')}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.status === 'completed' && !hasEvaluation(row)) return false;
    if (filters.status === 'pending' && hasEvaluation(row)) return false;
    if (['gross', 'review', 'appeal'].includes(filters.status) && !reasons.includes(filters.status)) return false;
    return true;
  });
  if (filters.queue !== 'attention') return filtered;
  const priority = row => attentionReasons(row, appeals).reduce((sum, reason) => sum + ({ gross: 4, review: 2, appeal: 1 }[reason] || 0), 0);
  return filtered.sort((a, b) => priority(b) - priority(a));
}

export function summarizeDialogs(rows, appeals = []) {
  const scores = rows.map(row => row.total).filter(Number.isFinite);
  return {
    total: rows.length,
    evaluated: rows.filter(hasEvaluation).length,
    average: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    gross: rows.filter(row => row.gross_error).length,
    attention: rows.filter(row => attentionReasons(row, appeals).length > 0).length,
  };
}

/** Source transcript indices only. A model-provided quote is never used as executable markup. */
export function reviewExcerpt(record, item, neighborCount = 1) {
  const transcript = Array.isArray(record?.transcript) ? record.transcript : [];
  const anchors = new Set();
  let invalidEvidence = false;
  for (const evidence of Array.isArray(item?.evidence) ? item.evidence : []) {
    if (Number.isInteger(evidence.turn) && evidence.turn >= 0 && evidence.turn < transcript.length) anchors.add(evidence.turn);
    else invalidEvidence = true;
  }
  const range = item?.checked_range;
  if (range) {
    if (Number.isInteger(range.from) && Number.isInteger(range.to) && range.from >= 0 && range.from <= range.to && range.to < transcript.length) {
      for (let i = range.from; i <= range.to; i++) anchors.add(i);
    } else invalidEvidence = true;
  }
  const indices = new Set();
  for (const anchor of anchors) {
    for (let i = Math.max(0, anchor - neighborCount); i <= Math.min(transcript.length - 1, anchor + neighborCount); i++) indices.add(i);
  }
  return {
    turns: [...indices].sort((a, b) => a - b).map(index => ({ ...transcript[index], index, highlighted: anchors.has(index) })),
    invalidEvidence,
    firstTurn: anchors.size ? Math.min(...anchors) : null,
  };
}
