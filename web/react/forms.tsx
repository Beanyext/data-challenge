import { Fragment, type ReactNode } from 'react';
import type { Appeal, Checklist, Criterion, CriterionResult, Scale, SavedNotice } from './types';
import { EmptyState, Icon, TurnText, label, number } from './shared';
import { Slot } from './slots';
import { translate as t, translatePlural } from './i18n';
import { turnTime } from './text';

const checklistKey = (checklist: Checklist) => `${checklist.id}@${checklist.version}`;

interface ChecklistEditorProps {
  checklist: Checklist;
  checklists: Checklist[];
  criterionIndex: number;
  dirty: boolean;
  saved?: SavedNotice | null;
}

/** After a new version is saved: older results keep their totals until they are evaluated again. */
export function SavedBanner({ notice }: { notice?: SavedNotice | null }) {
  if (!notice) return null;
  const stale = notice.stale.length;
  const version = notice.version;
  return <div className="saved-banner" role="status" data-reveal>
    <span className="saved-banner-symbol" aria-hidden="true"><Icon name="circleCheck" /></span>
    <div className="saved-banner-text">
      <strong>{translatePlural(notice.criteria, { one: 'Версия {version} сохранена: {count} критерий.', few: 'Версия {version} сохранена: {count} критерия.', many: 'Версия {version} сохранена: {count} критериев.' }, { version })}</strong>
      {stale > 0 && <p>{translatePlural(stale, { one: '{count} диалог оценён по более ранней версии. Его итог не меняется, пока его не переоценить.', few: '{count} диалога оценены по более ранней версии. Их итоги не меняются, пока их не переоценить.', many: '{count} диалогов оценены по более ранней версии. Их итоги не меняются, пока их не переоценить.' })}</p>}
    </div>
    {stale > 0 && <button type="button" className="btn btn-primary" data-action="reevaluate-saved">{translatePlural(stale, { one: 'Переоценить {count} диалог по v{version}', few: 'Переоценить {count} диалога по v{version}', many: 'Переоценить {count} диалогов по v{version}' }, { version })} <Icon name="arrow-right" /></button>}
    <button type="button" className="icon-btn saved-banner-close" data-action="dismiss-saved" aria-label={t('Закрыть сообщение')} title={t('Закрыть сообщение')}><Icon name="close" /></button>
  </div>;
}

export function ChecklistEditor({ checklist: cl, checklists, criterionIndex, dirty, saved }: ChecklistEditorProps) {
  const c = cl.criteria[criterionIndex];
  const hasSavedChecklist = checklists.some(item => item.id === cl.id);
  const editorKey = c ? `${c.id}:${criterionIndex}:${c.answer_type}:${Boolean(c.na_allowed)}:${Boolean(c.gross_error)}` : 'empty';
  const totalWeight = cl.criteria.filter(item => !item.gross_error).reduce((sum, item) => sum + Number(item.weight), 0);
  return <>
    <div className="page-heading" data-reveal>
      <div><h1>{t('Чек-листы')}</h1><p>{t('Настройте правила оценки. Сохранённая версия применяется при следующей проверке.')}</p></div>
      <div className="actions">
        <button className="btn" data-action="new-checklist">{t('Новый чек-лист')}</button>
        <button className="btn btn-primary" data-action="save-checklist">{t('Сохранить версию')} <Icon name="check" /></button>
      </div>
    </div>
    <Slot name="checklist-saved" fallback={<SavedBanner notice={saved} />} />
    <div className="editor-toolbar checklist-toolbar" data-reveal>
      <label>{t('Конфигурация')}
        <select id="choose-checklist" defaultValue={hasSavedChecklist ? checklistKey(cl) : ''}>
          {checklists.map(item => <option key={checklistKey(item)} value={checklistKey(item)}>{item.name} · v{item.version}</option>)}
          {!hasSavedChecklist && <option value="">{cl.name}</option>}
        </select>
      </label>
      <div className="weight-total"><span>{t('Сумма весов')}</span><strong id="weight-total">{number(totalWeight)}</strong></div>
      <span id="dirty-label" className={`badge ${dirty ? 'badge-amber' : ''}`}>{t(dirty ? 'Есть изменения' : 'Сохранено')}</span>
    </div>
    <div className="editor-layout checklist-workbench">
      <aside className="panel checklist-navigation" data-reveal>
        <div className="panel-heading"><h2>{t('Критерии')}</h2><span className="badge">{cl.criteria.length}</span></div>
        <div className="panel-body criteria-add"><button className="btn" data-action="add-criterion">＋ {t('Добавить критерий')}</button></div>
        <div className="editor-list">
          {cl.criteria.map((item, index) => <button key={item.id} className={`editor-item ${index === criterionIndex ? 'active' : ''}`} data-criterion-index={index} aria-current={index === criterionIndex ? 'true' : undefined}>
            <span className="editor-index">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{item.title}</strong><small>{item.gross_error ? t('Грубая ошибка') : t('Вес {weight} · {type}', { weight: number(item.weight), type: t(item.answer_type === 'scale' ? 'Шкала' : 'Да / Нет') })}</small></span>
          </button>)}
        </div>
      </aside>
      <section className="panel checklist-configuration" data-reveal>
        <div className="panel-body">
          <div className="checklist-name"><label>{t('Название чек-листа')}<input data-edit="name" defaultValue={cl.name} required maxLength={160} /></label></div>
          {c ? <Fragment key={editorKey}>
            <div className="editor-title-row">
              <div><span className="editor-eyebrow">{t('Настройка критерия')} · {c.id}</span><h2 id="criterion-heading">{c.title || t('Критерий {number}', { number: String(criterionIndex + 1).padStart(2, '0') })}</h2></div>
              <button className="btn btn-small btn-ghost danger" data-action="remove-criterion">{t('Удалить критерий')}</button>
            </div>
            <div className="editor-groups">
              <fieldset className="editor-fieldset">
                <legend>{t('Формулировка')}</legend>
                <div className="field-grid">
                  <label className="full">{t('Название критерия')}<input data-criterion="title" defaultValue={c.title} required maxLength={200} /></label>
                  <label className="full">{t('Что считается выполнением')}<textarea data-criterion="description" required defaultValue={c.description} /><span className="editor-help">{t('Опишите действие оператора и условия, при которых критерий выполнен.')}</span></label>
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend>{t('Оценка и вес')}</legend>
                <div className="field-grid">
                  <label>{t('Тип ответа')}<select data-criterion="answer_type" defaultValue={c.answer_type}><option value="binary">{t('Да / Нет')}</option><option value="scale">{t('Числовая шкала')}</option></select></label>
                  <label>{t('Вес критерия')}<input data-criterion="weight" type="number" min="0" max="100" step="0.1" defaultValue={c.weight} disabled={Boolean(c.gross_error)} /><span className="editor-help">{t(c.gross_error ? 'Грубая ошибка отмечается отдельно от баллов.' : 'Вклад критерия в итоговую оценку.')}</span></label>
                  {c.answer_type === 'scale' && <div className="full editor-scale">
                    <label>{t('Ступени шкалы')}<textarea data-criterion="steps" rows={6} placeholder={t('0 | Нет ответа\n10 | Полный ответ')} defaultValue={c._stepsText ?? (c.scale?.steps || []).map(step => `${step.value} | ${step.label}`).join('\n')} /><span className="editor-help">{t('Одна ступень на строку: число | описание. Максимум шкалы определяется по наибольшему числу.')}</span></label>
                    <aside className="editor-scale-guide" id="scale-preview"><Slot name="scale-preview" fallback={<ScalePreview scale={c.scale} />} /></aside>
                  </div>}
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend>{t('Применимость')}</legend>
                <div className="field-grid">
                  <label className="full">{t('Раздел')}<select data-criterion="section_id" defaultValue={c.section_id}>{cl.sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
                  <label className="full editor-option"><input data-criterion="na_allowed" type="checkbox" defaultChecked={Boolean(c.na_allowed)} /><span><strong>{t('Разрешить ответ N/A')}</strong><small>{t('Критерий может быть неприменим к конкретному диалогу.')}</small></span><span className="badge editor-neutral" aria-hidden="true">N/A</span></label>
                  {c.na_allowed && <label className="full">{t('Когда критерий неприменим')}<textarea data-criterion="na_rule" required defaultValue={c.na_rule || ''} /></label>}
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend>{t('Особые условия')}</legend>
                <div className="field-grid">
                  <label className="full editor-option editor-option-critical"><input data-criterion="gross_error" type="checkbox" defaultChecked={Boolean(c.gross_error)} /><span><strong>{t('Грубое нарушение')}</strong><small>{t('Отдельный флаг без баллов.')}</small></span></label>
                  <label className="full">{t('Пояснения для оценки')}<textarea data-criterion="notes" defaultValue={c.notes || ''} /></label>
                </div>
              </fieldset>
            </div>
          </Fragment> : <EmptyState title={t('Добавьте критерий')} text={t('Укажите название, правило, вес и допустимый тип ответа.')} />}
          <div id="editor-errors" role="alert"><Slot name="editor-errors" /></div>
        </div>
      </section>
    </div>
  </>;
}

export function ScalePreview({ scale }: { scale?: Scale | null }) {
  const steps = Array.isArray(scale?.steps) ? scale.steps : [];
  if (!steps.length) return <div className="scale-preview-empty"><strong>{t('Предпросмотр шкалы')}</strong><p>{t('Добавьте ступени в поле «Ступени шкалы». Здесь появятся баллы и условия.')}</p></div>;
  return <>
    <table><caption>{t('Предпросмотр шкалы')}</caption><thead><tr><th scope="col">{t('Балл')}</th><th scope="col">{t('Условие')}</th></tr></thead>
      <tbody>{steps.map((step, index) => <tr key={index}>
        <td>{Number.isFinite(step?.value) ? String(step.value) : <span className="scale-preview-incomplete">{t('Проверьте число')}</span>}</td>
        <td>{String(step?.label ?? '').trim() ? step.label : <span className="scale-preview-incomplete">{t('Добавьте описание')}</span>}</td>
      </tr>)}</tbody>
    </table>
    <p>{t('Текущие ступени из поля «Ступени шкалы».')}</p>
  </>;
}

/**
 * Turn numbers in appeal texts. A message shown in the fragment is highlighted there;
 * any other message opens the conversation at that message. Numbers outside a known transcript stay plain text.
 */
function appealReference(appeal: Appeal, transcriptLength?: number) {
  const shown = new Set((appeal.fragment || []).map(turn => turn.turn));
  return (n: number): ReactNode => {
    if (n < 1 || typeof transcriptLength === 'number' && transcriptLength > 0 && n > transcriptLength) return null;
    const turn = n - 1;
    if (shown.has(turn)) return <button type="button" className="turn-ref" data-fragment-appeal={appeal.id} data-fragment-turn={turn} aria-label={t('Показать реплику № {n} во фрагменте', { n })} title={t('Показать реплику № {n} во фрагменте', { n })}>№ {n}</button>;
    return <button type="button" className="turn-ref" data-context={appeal.id} data-context-turn={turn} aria-label={t('Открыть диалог на реплике № {n}', { n })} title={t('Открыть диалог на реплике № {n}', { n })}>№ {n}</button>;
  };
}
const fragmentText = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();
const shorten = (text: unknown, limit = 200) => { const value = fragmentText(text); return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value; };

function AppealDispute({ appeal }: { appeal: Appeal }) {
  const item = appeal.criterion;
  if (!item) return null;
  const answer = typeof item.answer === 'number' ? number(item.answer) : label(item.answer);
  const parts: string[] = [];
  if (item.gross_error || (item.weight === 0 && item.effective_weight === 0)) parts.push(t('без баллов'));
  else if (typeof item.points === 'number' && typeof item.effective_weight === 'number') parts.push(t('баллы {points} из {max}', { points: number(item.points), max: number(item.effective_weight) }));
  if (typeof appeal.total === 'number') parts.push(t('итог диалога {total}', { total: number(appeal.total) }));
  return <p className="appeal-dispute">{t('Спорная оценка:')} <strong>{answer}</strong>{parts.map(part => <span key={part}> · {part}</span>)}</p>;
}

function AppealFragment({ appeal }: { appeal: Appeal }) {
  const fragment = Array.isArray(appeal.fragment) ? appeal.fragment : [];
  if (!fragment.length) return null;
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  const evidence = new Set((appeal.criterion?.evidence || []).map(entry => entry.turn));
  return <section className="appeal-fragment" aria-label={t('Фрагмент диалога')}>
    <h4>{t('Фрагмент диалога')}</h4>
    <ol>{fragment.map(turn => {
      const time = turnTime(turn);
      const isEvidence = evidence.has(turn.turn);
      return <li key={turn.turn} id={`appeal-${appeal.id}-turn-${turn.turn}`} tabIndex={-1} className={isEvidence ? 'is-evidence' : ''}>
        <span className="appeal-fragment-meta">№ {turn.turn + 1} · {roles[turn.speaker ?? ''] || turn.speaker || '—'}{time && ` · ${time}`}</span>
        {isEvidence && <span className="appeal-fragment-tag">{t('Доказательство')}</span>}
        <span className="appeal-fragment-text"> — {shorten(turn.text)}</span>
        {fragmentText(turn.text).length > 200 && <button type="button" className="text-btn appeal-full-turn" data-context={appeal.id} data-context-turn={turn.turn} aria-label={t('Перейти к полной реплике № {n}', { n: turn.turn + 1 })}>{t('Перейти к полной реплике')} <Icon name="arrow-right" /></button>}
      </li>;
    })}</ol>
  </section>;
}

export function AppealsView({ appeals, filter, turnCounts = {} }: { appeals: Appeal[]; filter: 'all' | 'open'; turnCounts?: Record<string, number> }) {
  const visible = appeals.filter(appeal => filter === 'all' || appeal.status === 'open');
  return <>
    <div className="page-heading" data-reveal><div><h1>{t('Апелляции')}</h1><p>{t('Сопоставьте комментарий оператора с диалогом и сохраните обоснованное решение.')}</p></div><button className="btn" data-action="retry"><Icon name="rotate" /> {t('Обновить список')}</button></div>
    <div className="view-tabs" data-reveal><button className={`btn ${filter === 'open' ? 'btn-dark' : ''}`} data-appeal-filter="open">{t('Открытые')} · {appeals.filter(appeal => appeal.status === 'open').length}</button><button className={`btn ${filter === 'all' ? 'btn-dark' : ''}`} data-appeal-filter="all">{t('Все обращения')} · {appeals.length}</button></div>
    <section className="panel appeal-queue" data-reveal>
      {visible.length ? visible.map(appeal => <article className="appeal-card" id={`appeal-${appeal.id}`} key={appeal.id}>
        <div className="appeal-content">
          <div className="appeal-meta"><span className={`badge ${appeal.status === 'open' ? 'badge-amber' : 'badge-green'}`}>{label(appeal.status)}</span><span className="muted small">{appeal.conversation_id || appeal.evaluation_id} · {appeal.criterion_id}</span></div>
          <h3>{appeal.criterion_title || appeal.criterion?.title || t('Пересмотр критерия')}</h3>
          <AppealDispute appeal={appeal} />
          <div className={`appeal-perspectives ${appeal.decision ? 'has-decision' : ''}`}>
            <section className="appeal-statement"><h4>{t('Комментарий оператора')}</h4><p>{appeal.comment}</p></section>
            {appeal.decision && <section className="appeal-statement appeal-decision"><h4>{t('Решение проверяющего')}</h4><strong className="appeal-answer">{t('Ответ: {answer}', { answer: label(appeal.decision.answer) })}</strong><p>{appeal.decision.reason}</p></section>}
          </div>
          <details className="appeal-evidence" id={`appeal-evidence-${appeal.id}`}>
            <summary>{t('Обоснование и фрагмент')}</summary>
            {appeal.criterion && (appeal.criterion.reason || appeal.criterion.explanation) && <p className="appeal-reason"><TurnText text={appeal.criterion.reason || appeal.criterion.explanation} reference={appealReference(appeal, turnCounts[appeal.conversation_id ?? ''])} /></p>}
            {appeal.fragment?.length ? <AppealFragment appeal={appeal} /> : <p className="muted small">{t('В апелляции нет фрагмента. Откройте диалог, чтобы проверить контекст.')}</p>}
          </details>
        </div>
        <div className="actions appeal-actions"><button className="btn btn-small" data-context={appeal.id}>{t('Открыть диалог')} <Icon name="arrow-right" /></button>{appeal.status === 'open' && <button className="btn btn-small btn-primary" data-review={appeal.id}>{t('Рассмотреть')}</button>}</div>
        <div className="review-form" id={`review-${appeal.id}`} hidden><Slot name={`review-${appeal.id}`} /></div>
      </article>) : <EmptyState title={t(filter === 'open' ? 'Нет открытых апелляций' : 'Апелляций пока нет')} text={t('Чтобы оспорить оценку, откройте диалог и нажмите «Оспорить» у нужного критерия.')} actions={<a className="btn" href="#dialogs">{t('Перейти к диалогам')}</a>} />}
    </section>
  </>;
}

/** Answer choices with their meaning: scale steps carry the checklist wording, yes/no/N/A get plain captions. */
function answerOption(answer: string | number, criterion: Criterion): string {
  if (typeof answer === 'number') {
    const step = criterion.scale?.steps?.find(item => item.value === answer);
    return step?.label ? `${number(answer)} — ${step.label}` : number(answer);
  }
  if (answer === 'na') return t('N/A — критерий не применяется');
  if (criterion.gross_error) return t(answer === 'yes' ? 'Да — нарушение выявлено' : 'Нет — нарушения нет');
  return t(answer === 'yes' ? 'Да — критерий выполнен' : 'Нет — критерий не выполнен');
}

export function ReviewForm({ appeal, criterion, item, transcriptLength }: { appeal: Appeal; criterion: Criterion; item: CriterionResult; transcriptLength?: number }) {
  const answers = [...(criterion.answer_type === 'scale' ? (criterion.scale?.steps || []).map(step => step.value) : ['yes', 'no']), ...(criterion.na_allowed ? ['na'] : [])];
  return <form data-decision={appeal.id} className="form-stack appeal-review-layout" data-reveal>
    <aside className="appeal-current"><span className="editor-eyebrow">{t('Текущая оценка')}</span><h4>{criterion.title}</h4><div className="appeal-current-answer"><span>{t('Ответ по критерию')}</span><strong>{label(item.answer)}</strong></div><p><TurnText text={item.explanation} reference={appealReference(appeal, transcriptLength)} /></p><button className="text-btn" type="button" data-context={appeal.id}>{t('Проверить фрагмент диалога')} <Icon name="arrow-right" /></button></aside>
    <div className="form-stack appeal-review-fields">
      <fieldset className="appeal-review-choice"><legend>{t('Решение проверяющего')}</legend><div className="radio-row"><label><input type="radio" name="decision-status" value="confirmed" defaultChecked /><span>{t('Подтвердить оценку')}</span></label><label><input type="radio" name="decision-status" value="changed" /><span>{t('Изменить оценку')}</span></label></div></fieldset>
      <label>{t('Ответ после рассмотрения')}<select name="answer" data-original={item.answer} defaultValue={String(item.answer)} disabled>{answers.map(answer => <option key={String(answer)} value={answer}>{answerOption(answer, criterion)}</option>)}</select><span className="editor-help">{t('Для выбора другого ответа отметьте «Изменить оценку».')}</span></label>
      <label>{t('Причина решения')}<textarea name="reason" required maxLength={4000} placeholder={t('Объясните, что подтверждает решение')} /></label>
      <div className="actions appeal-review-actions"><button className="btn btn-primary" type="submit">{t('Сохранить решение')}</button><button className="btn" type="button" data-cancel-review={appeal.id}>{t('Отмена')}</button></div>
    </div>
  </form>;
}
