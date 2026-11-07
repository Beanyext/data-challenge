// Short-lived, tab-local UI drafts used only for an explicit language reload.
// No requests or transcripts are collected; file/password inputs are excluded.
export const DRAFT_KEY = 'cqa-language-draft-v1';
const MAX_AGE = 10 * 60 * 1000;
export function storeLanguageDraft(draft, storage, now = Date.now()) {
  try { (storage ?? sessionStorage).setItem(DRAFT_KEY, JSON.stringify({ ...draft, version: 1, createdAt: now })); return true; }
  catch { return false; }
}
export function takeLanguageDraft(locale, route, storage, now = Date.now()) {
  try {
    storage ??= sessionStorage;
    const raw = storage.getItem(DRAFT_KEY);
    storage.removeItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft.version !== 1 || draft.locale !== locale || draft.route !== route || !Number.isFinite(draft.createdAt) || now - draft.createdAt > MAX_AGE || now < draft.createdAt) return null;
    if (!draft.filters || !['query','channel','language','status'].every(key => typeof draft.filters[key] === 'string')) return null;
    if (!Array.isArray(draft.selected) || !draft.selected.every(id => typeof id === 'string')) return null;
    if (draft.editor && (!Array.isArray(draft.editor.criteria) || !Array.isArray(draft.editor.sections) || typeof draft.editor.name !== 'string')) return null;
    if (!Array.isArray(draft.forms)) return null;
    return draft;
  } catch { return null; }
}
export function captureFormDrafts(root = document) {
  return [...root.querySelectorAll('#modal form, form[data-decision]')].filter(form => !form.closest('[hidden]') && (!form.closest('dialog') || form.closest('dialog').open)).map(form => ({
    id: form.id, decision: form.dataset.decision,
    evaluationIds: form._ids,
    fields: [...form.elements].filter(field => ['INPUT','TEXTAREA','SELECT'].includes(field.tagName) && field.name && !['file','password'].includes(field.type)).map(field => ({ name: field.name, type: field.type, value: field.value, checked: Boolean(field.checked), disabled: field.disabled })),
  }));
}
export function restoreFormDrafts(drafts, root = document) {
  for (const draft of drafts) {
    const form = [...root.querySelectorAll('form')].find(item => draft.id ? item.id === draft.id : item.dataset.decision === draft.decision);
    if (!form || !Array.isArray(draft.fields)) continue;
    const remaining = [...form.elements];
    for (const field of draft.fields) {
      const index = remaining.findIndex(element => element.name === field.name && element.type === field.type);
      if (index < 0) continue;
      const element = remaining.splice(index, 1)[0];
      if (element.type === 'file' || element.type === 'password') continue;
      element.value = field.value;
      if (['radio','checkbox'].includes(element.type)) element.checked = field.checked;
      element.disabled = Boolean(field.disabled);
    }
    if (Array.isArray(draft.evaluationIds)) form._ids = draft.evaluationIds;
  }
}
