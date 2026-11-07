const CRITERION_FIELDS = [
  ['title', 'Название'],
  ['description', 'Правило оценки'],
  ['weight', 'Вес'],
  ['answer_type', 'Тип ответа'],
  ['scale', 'Шкала'],
  ['na_allowed', 'Допустимость N/A'],
  ['na_rule', 'Условие N/A'],
  ['notes', 'Пояснения'],
  ['gross_error', 'Грубое нарушение'],
  ['section_id', 'Раздел'],
];
const CHECKLIST_FIELDS = [
  ['name', 'Название чек-листа'],
  ['guidance', 'Общие правила'],
  ['sections', 'Разделы чек-листа'],
  ['rounding', 'Округление'],
];
const META_FIELDS = new Set(['id', 'version', '_stepsText', 'metadata', 'created_at', 'updated_at', 'saved_at', 'server_metadata']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = value => isObject(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).filter(key => !META_FIELDS.has(key)).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function normalize(field, value) {
  if (['na_allowed', 'gross_error'].includes(field)) return Boolean(value);
  if (field === 'weight') return value === undefined || value === null || value === '' ? 0 : Number(value);
  if (field === 'guidance') return list(value).map(text);
  if (field === 'sections') return list(value).map(section => ({ id: text(section?.id), name: text(section?.name) }));
  if (field === 'rounding') return canonical(object(value));
  if (field === 'scale') {
    if (value == null) return null;
    return {
      min: value.min == null ? null : Number(value.min),
      max: value.max == null ? null : Number(value.max),
      steps: list(value.steps).map(step => ({ value: step?.value == null ? null : Number(step.value), label: text(step?.label) })),
    };
  }
  return text(value);
}

function display(field, value) {
  if (value == null || value === '' || Array.isArray(value) && value.length === 0) return '—';
  if (['na_allowed', 'gross_error'].includes(field)) return value ? 'Да' : 'Нет';
  if (field === 'answer_type') return ({ binary: 'Да / Нет', scale: 'Числовая шкала' })[value] || text(value);
  if (field === 'guidance') return value.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
  if (field === 'sections') return value.map(section => `${section.id || 'Без ID'} · ${section.name || 'Без названия'}`).join('\n');
  if (field === 'scale') return [
    `От ${value.min ?? '—'} до ${value.max ?? '—'}`,
    ...value.steps.map(step => `${step.value ?? '—'} | ${step.label}`),
  ].join('\n');
  if (field === 'rounding') {
    const entries = Object.entries(value);
    if (!entries.length) return '—';
    return entries.map(([key, setting]) => `${key === 'digits' ? 'Знаков после запятой' : key}: ${isObject(setting) || Array.isArray(setting) ? JSON.stringify(setting) : setting}`).join('\n');
  }
  return text(value);
}

function criterionTitle(criterion) {
  return text(criterion.title) || text(criterion.id) || 'Критерий без названия';
}

function criterionSummary(criterion) {
  return CRITERION_FIELDS.map(([field, label]) => `${label}: ${display(field, normalize(field, criterion[field]))}`).join('\n');
}

function criteriaById(checklist) {
  // Missing IDs are kept by position for a readable preview; valid editor data has stable IDs.
  return new Map(list(checklist.criteria).filter(isObject).map((criterion, index) => [criterion.id == null || criterion.id === '' ? `\u0000${index}` : String(criterion.id), criterion]));
}

/** Compare persisted settings only. IDs match criteria; versions and server metadata are not edits. */
export function compareChecklists(before, after) {
  const oldChecklist = object(before), newChecklist = object(after), changes = [];
  const newConfiguration = before == null && isObject(after);
  for (const [field, label] of CHECKLIST_FIELDS) {
    const oldValue = normalize(field, oldChecklist[field]);
    const newValue = normalize(field, newChecklist[field]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push({ kind: newConfiguration ? 'added' : 'changed', title: 'Настройки чек-листа', field, label, before: display(field, oldValue), after: display(field, newValue) });
    }
  }

  const oldCriteria = criteriaById(oldChecklist), newCriteria = criteriaById(newChecklist);
  for (const [id, criterion] of oldCriteria) {
    if (!newCriteria.has(id)) changes.push({ kind: 'removed', ...(criterion.id == null ? {} : { criterion_id: String(criterion.id) }), title: criterionTitle(criterion), field: 'criterion', label: 'Критерий удалён', before: criterionSummary(criterion), after: '—' });
  }
  for (const [id, criterion] of newCriteria) {
    const old = oldCriteria.get(id);
    if (!old) {
      changes.push({ kind: 'added', ...(criterion.id == null ? {} : { criterion_id: String(criterion.id) }), title: criterionTitle(criterion), field: 'criterion', label: 'Новый критерий', before: '—', after: criterionSummary(criterion) });
      continue;
    }
    for (const [field, label] of CRITERION_FIELDS) {
      const oldValue = normalize(field, old[field]), newValue = normalize(field, criterion[field]);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ kind: 'changed', ...(criterion.id == null ? {} : { criterion_id: String(criterion.id) }), title: criterionTitle(criterion), field, label, before: display(field, oldValue), after: display(field, newValue) });
      }
    }
  }

  // Added or removed items do not falsely report a reorder of the remaining criteria.
  const oldOrder = [...oldCriteria.keys()].filter(id => newCriteria.has(id));
  const newOrder = [...newCriteria.keys()].filter(id => oldCriteria.has(id));
  if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
    const order = (ids, source) => ids.map((id, index) => `${index + 1}. ${source.get(id).id ?? 'Без ID'} · ${criterionTitle(source.get(id))}`).join('\n');
    changes.push({ kind: 'changed', title: 'Порядок критериев', field: 'criteria_order', label: 'Порядок оставшихся критериев', before: order(oldOrder, oldCriteria), after: order(newOrder, newCriteria) });
  }
  return { changed: changes.length > 0, changes };
}

/** HTML is safe to insert: all variable text is escaped, including server-provided titles. */
export function renderChecklistDiff(result) {
  const changes = list(result?.changes);
  if (!changes.length) return '<div class="diff-list" role="status"><p>Изменений нет. Настройки совпадают с сохранённой версией.</p></div>';
  const groups = [['added', 'Добавлено'], ['removed', 'Удалено'], ['changed', 'Изменено']];
  const lines = value => esc(value).replace(/\n/g, '<br>');
  return `<div class="diff-list" role="region" aria-label="Изменения чек-листа">${groups.map(([kind, title]) => {
    const items = changes.filter(item => item?.kind === kind);
    if (!items.length) return '';
    return `<section aria-label="${title}"><h3>${title} · ${items.length}</h3>${items.map(item => `<article class="diff-item"><h4>${esc(item.title)}</h4><p>${esc(item.label)}${item.criterion_id ? ` · ${esc(item.criterion_id)}` : ''}</p><div class="diff-before"><strong>Было</strong><p>${lines(item.before)}</p></div><div class="diff-after"><strong>Станет</strong><p>${lines(item.after)}</p></div></article>`).join('')}</section>`;
  }).join('')}</div>`;
}
