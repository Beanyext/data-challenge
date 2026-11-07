import { Fragment } from 'react';
import type { Appeal, Checklist, Criterion, CriterionResult, Scale } from './types';
import { EmptyState, Icon, label, number } from './shared';
import { Slot } from './slots';

const checklistKey = (checklist: Checklist) => `${checklist.id}@${checklist.version}`;

interface ChecklistEditorProps {
  checklist: Checklist;
  checklists: Checklist[];
  criterionIndex: number;
  dirty: boolean;
}

export function ChecklistEditor({ checklist: cl, checklists, criterionIndex, dirty }: ChecklistEditorProps) {
  const c = cl.criteria[criterionIndex];
  const hasSavedChecklist = checklists.some(item => item.id === cl.id);
  const editorKey = c ? `${c.id}:${criterionIndex}:${c.answer_type}:${Boolean(c.na_allowed)}:${Boolean(c.gross_error)}` : 'empty';
  const totalWeight = cl.criteria.filter(item => !item.gross_error).reduce((sum, item) => sum + Number(item.weight), 0);
  return <>
    <div className="page-heading" data-reveal>
      <div><h1>Чек-листы</h1><p>Настройте правила оценки. Сохранённая версия применяется при следующей проверке.</p></div>
      <div className="actions">
        <button className="btn" data-action="new-checklist">Новый чек-лист</button>
        <button className="btn btn-primary" data-action="save-checklist">Сохранить версию <Icon name="check" /></button>
      </div>
    </div>
    <div className="editor-toolbar checklist-toolbar" data-reveal>
      <label>Конфигурация
        <select id="choose-checklist" defaultValue={hasSavedChecklist ? checklistKey(cl) : ''}>
          {checklists.map(item => <option key={checklistKey(item)} value={checklistKey(item)}>{item.name} · v{item.version}</option>)}
          {!hasSavedChecklist && <option value="">{cl.name}</option>}
        </select>
      </label>
      <div className="weight-total"><span>Сумма весов</span><strong id="weight-total">{number(totalWeight)}</strong></div>
      <span id="dirty-label" className={`badge ${dirty ? 'badge-amber' : ''}`}>{dirty ? 'Есть изменения' : 'Сохранено'}</span>
    </div>
    <div className="editor-layout checklist-workbench">
      <aside className="panel checklist-navigation" data-reveal>
        <div className="panel-heading"><h2>Критерии</h2><span className="badge">{cl.criteria.length}</span></div>
        <div className="editor-list">
          {cl.criteria.map((item, index) => <button key={item.id} className={`editor-item ${index === criterionIndex ? 'active' : ''}`} data-criterion-index={index} aria-current={index === criterionIndex ? 'true' : undefined}>
            <span className="editor-index">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{item.title}</strong><small>{item.gross_error ? 'Грубая ошибка' : `Вес ${number(item.weight)} · ${item.answer_type === 'scale' ? 'Шкала' : 'Да / Нет'}`}</small></span>
          </button>)}
        </div>
        <div className="panel-body"><button className="btn" data-action="add-criterion">＋ Добавить критерий</button></div>
      </aside>
      <section className="panel checklist-configuration" data-reveal>
        <div className="panel-body">
          <div className="checklist-name"><label>Название чек-листа<input data-edit="name" defaultValue={cl.name} required maxLength={160} /></label></div>
          {c ? <Fragment key={editorKey}>
            <div className="editor-title-row">
              <div><span className="editor-eyebrow">Настройка критерия · {c.id}</span><h2>Критерий {String(criterionIndex + 1).padStart(2, '0')}</h2></div>
              <button className="btn btn-small btn-ghost danger" data-action="remove-criterion">Удалить критерий</button>
            </div>
            <div className="editor-groups">
              <fieldset className="editor-fieldset">
                <legend><span className="editor-step" aria-hidden="true">01</span>Формулировка</legend>
                <div className="field-grid">
                  <label className="full">Название критерия<input data-criterion="title" defaultValue={c.title} required maxLength={200} /></label>
                  <label className="full">Что считается выполнением<textarea data-criterion="description" required defaultValue={c.description} /><span className="editor-help">Опишите действие оператора и условия, при которых критерий выполнен.</span></label>
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend><span className="editor-step" aria-hidden="true">02</span>Оценка и вес</legend>
                <div className="field-grid">
                  <label>Тип ответа<select data-criterion="answer_type" defaultValue={c.answer_type}><option value="binary">Да / Нет</option><option value="scale">Числовая шкала</option></select></label>
                  <label>Вес критерия<input data-criterion="weight" type="number" min="0" max="100" step="0.1" defaultValue={c.weight} disabled={Boolean(c.gross_error)} /><span className="editor-help">{c.gross_error ? 'Грубая ошибка отмечается отдельно от баллов.' : 'Вклад критерия в итоговую оценку.'}</span></label>
                  {c.answer_type === 'scale' && <div className="full editor-scale">
                    <label>Ступени шкалы<textarea data-criterion="steps" rows={6} placeholder={'0 | Нет ответа\n10 | Полный ответ'} defaultValue={(c.scale?.steps || []).map(step => `${step.value} | ${step.label}`).join('\n')} /><span className="editor-help">Одна ступень на строку: число | описание. Максимум шкалы определяется по наибольшему числу.</span></label>
                    <aside className="editor-scale-guide" id="scale-preview"><Slot name="scale-preview" fallback={<ScalePreview scale={c.scale} />} /></aside>
                  </div>}
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend><span className="editor-step" aria-hidden="true">03</span>Применимость</legend>
                <div className="field-grid">
                  <label className="full">Раздел<select data-criterion="section_id" defaultValue={c.section_id}>{cl.sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
                  <label className="full editor-option"><input data-criterion="na_allowed" type="checkbox" defaultChecked={Boolean(c.na_allowed)} /><span><strong>Разрешить ответ N/A</strong><small>Критерий может быть неприменим к конкретному диалогу.</small></span><span className="badge editor-neutral" aria-hidden="true">N/A</span></label>
                  {c.na_allowed && <label className="full">Когда критерий неприменим<textarea data-criterion="na_rule" required defaultValue={c.na_rule || ''} /></label>}
                </div>
              </fieldset>
              <fieldset className="editor-fieldset">
                <legend><span className="editor-step" aria-hidden="true">04</span>Особые условия</legend>
                <div className="field-grid">
                  <label className="full editor-option editor-option-critical"><input data-criterion="gross_error" type="checkbox" defaultChecked={Boolean(c.gross_error)} /><span><strong>Грубое нарушение</strong><small>Отдельный флаг без баллов.</small></span></label>
                  <label className="full">Пояснения для оценки<textarea data-criterion="notes" defaultValue={c.notes || ''} /></label>
                </div>
              </fieldset>
            </div>
          </Fragment> : <EmptyState title="Добавьте критерий" text="Укажите название, правило, вес и допустимый тип ответа." />}
          <div id="editor-errors" role="alert"><Slot name="editor-errors" /></div>
        </div>
      </section>
    </div>
  </>;
}

export function ScalePreview({ scale }: { scale?: Scale | null }) {
  const steps = Array.isArray(scale?.steps) ? scale.steps : [];
  if (!steps.length) return <div className="scale-preview-empty"><strong>Предпросмотр шкалы</strong><p>Добавьте ступени в поле «Ступени шкалы». Здесь появятся баллы и условия.</p></div>;
  return <>
    <table><caption>Предпросмотр шкалы</caption><thead><tr><th scope="col">Балл</th><th scope="col">Условие</th></tr></thead>
      <tbody>{steps.map((step, index) => <tr key={index}>
        <td>{Number.isFinite(step?.value) ? String(step.value) : <span className="scale-preview-incomplete">Проверьте число</span>}</td>
        <td>{String(step?.label ?? '').trim() ? step.label : <span className="scale-preview-incomplete">Добавьте описание</span>}</td>
      </tr>)}</tbody>
    </table>
    <p>Текущие ступени из поля «Ступени шкалы».</p>
  </>;
}

export function AppealsView({ appeals, filter }: { appeals: Appeal[]; filter: 'all' | 'open' }) {
  const visible = appeals.filter(appeal => filter === 'all' || appeal.status === 'open');
  return <>
    <div className="page-heading" data-reveal><div><h1>Апелляции</h1><p>Сопоставьте комментарий оператора с диалогом и сохраните обоснованное решение.</p></div><button className="btn" data-action="retry"><Icon name="rotate" /> Обновить список</button></div>
    <div className="view-tabs" data-reveal><button className={`btn ${filter === 'open' ? 'btn-dark' : ''}`} data-appeal-filter="open">Открытые · {appeals.filter(appeal => appeal.status === 'open').length}</button><button className={`btn ${filter === 'all' ? 'btn-dark' : ''}`} data-appeal-filter="all">Все обращения · {appeals.length}</button></div>
    <section className="panel appeal-queue" data-reveal>
      {visible.length ? visible.map(appeal => <article className="appeal-card" id={`appeal-${appeal.id}`} key={appeal.id}>
        <div className="appeal-content">
          <div className="appeal-meta"><span className={`badge ${appeal.status === 'open' ? 'badge-amber' : 'badge-green'}`}>{label(appeal.status)}</span><span className="muted small">{appeal.conversation_id || appeal.evaluation_id} · {appeal.criterion_id}</span></div>
          <h3>{appeal.criterion_title || 'Пересмотр критерия'}</h3>
          <div className={`appeal-perspectives ${appeal.decision ? 'has-decision' : ''}`}>
            <section className="appeal-statement"><h4>Комментарий оператора</h4><p>{appeal.comment}</p></section>
            {appeal.decision && <section className="appeal-statement appeal-decision"><h4>Решение проверяющего</h4><strong className="appeal-answer">Ответ: {label(appeal.decision.answer)}</strong><p>{appeal.decision.reason}</p></section>}
          </div>
        </div>
        <div className="actions appeal-actions"><button className="btn btn-small" data-context={appeal.id}>Открыть диалог <Icon name="arrow-right" /></button>{appeal.status === 'open' && <button className="btn btn-small btn-primary" data-review={appeal.id}>Рассмотреть</button>}</div>
        <div className="review-form" id={`review-${appeal.id}`} hidden><Slot name={`review-${appeal.id}`} /></div>
      </article>) : <EmptyState title={filter === 'open' ? 'Нет открытых апелляций' : 'Апелляций пока нет'} text="Чтобы оспорить оценку, откройте диалог и нажмите «Оспорить» у нужного критерия." actions={<a className="btn" href="#dialogs">Перейти к диалогам</a>} />}
    </section>
  </>;
}

export function ReviewForm({ appeal, criterion, item }: { appeal: Appeal; criterion: Criterion; item: CriterionResult }) {
  const answers = [...(criterion.answer_type === 'scale' ? (criterion.scale?.steps || []).map(step => step.value) : ['yes', 'no']), ...(criterion.na_allowed ? ['na'] : [])];
  return <form data-decision={appeal.id} className="form-stack appeal-review-layout" data-reveal>
    <aside className="appeal-current"><span className="editor-eyebrow">Текущая оценка</span><h4>{criterion.title}</h4><div className="appeal-current-answer"><span>Ответ по критерию</span><strong>{label(item.answer)}</strong></div><p>{item.explanation}</p><button className="text-btn" type="button" data-context={appeal.id}>Проверить фрагмент диалога <Icon name="arrow-right" /></button></aside>
    <div className="form-stack appeal-review-fields">
      <fieldset className="appeal-review-choice"><legend>Решение проверяющего</legend><div className="radio-row"><label><input type="radio" name="decision-status" value="confirmed" defaultChecked /><span>Подтвердить оценку</span></label><label><input type="radio" name="decision-status" value="changed" /><span>Изменить оценку</span></label></div></fieldset>
      <label>Ответ после рассмотрения<select name="answer" data-original={item.answer} defaultValue={String(item.answer)} disabled>{answers.map(answer => <option key={String(answer)} value={answer}>{label(answer)}</option>)}</select><span className="editor-help">Для выбора другого ответа отметьте «Изменить оценку».</span></label>
      <label>Причина решения<textarea name="reason" required maxLength={4000} placeholder="Объясните, что подтверждает решение" /></label>
      <div className="actions appeal-review-actions"><button className="btn btn-primary" type="submit">Сохранить решение</button><button className="btn" type="button" data-cancel-review={appeal.id}>Отмена</button></div>
    </div>
  </form>;
}
