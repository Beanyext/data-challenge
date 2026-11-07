import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ComponentProps, ReactNode } from 'react';
import { DialogsView, DialogRows, DialogView, ErrorView, LoadingView, ModalContents, type ModalProps } from './pages';
import { ChecklistEditor, AppealsView, ReviewForm, ScalePreview } from './forms';
import { Icon, EmptyState } from './shared';
import { clearSlots, setSlot } from './slots';
import { MotionFrame, installInteractionMotion, animateElement } from './motion';
import type { DialogRecord, Scale } from './types';
import { translate as t, localizeMessage, localizeShell, reloadInLanguage, type Locale } from './i18n';
import { LanguageSwitcher } from './language-switcher';
import { FocusToggle } from './review-tools';
import { ActiveFilters, SelectionSummary } from './list-tools';
import type { Filters } from './types';
export { translate, formatNumber, localizeMessage, getLocale } from './i18n';

// React owns the view trees. The existing controller keeps API calls and decisions.
// Synchronous commits are limited to this boundary because it immediately reads
// form controls, focus targets and the audio element after rendering.
const roots = new Map<string, Root>();
let revision = 0;
let lastScene = '';
const disposeMotion = typeof document === 'undefined' ? () => {} : installInteractionMotion();
function mount(id: string, element: ReactNode) {
  const container = document.getElementById(id);
  if (!container) return;
  let root = roots.get(id);
  if (!root) { root = createRoot(container); roots.set(id, root); }
  flushSync(() => root.render(element));
}
function page(element: ReactNode, loading = false) {
  const scene = location.hash || '#dialogs';
  const subtle = scene === lastScene;
  if (!loading) lastScene = scene;
  flushSync(() => clearSlots());
  mount('main', loading ? element : <MotionFrame key={++revision} subtle={subtle}>{element}</MotionFrame>);
}
function slot(name: string, element: ReactNode) { flushSync(() => setSlot(name, element)); }

export const ui = {
  language(beforeReload: (locale: Locale) => boolean, failedReload: () => void = () => {}) {
    localizeShell();
    mount('workspace-tools', <FocusToggle/>);
    mount('language-switcher', <LanguageSwitcher onSelect={locale => reloadInLanguage(locale, { beforeReload: async value => {
      if (!beforeReload(value)) return false;
      const main = document.getElementById('main');
      const animation = main && animateElement(main, [{ opacity: 1 }, { opacity: .78 }], { duration: 120 });
      if (animation) await animation.finished.catch(() => {});
      return true;
    } }).catch(() => { failedReload(); return false; })}/>);
  },
  loading: () => page(<LoadingView/>, true),
  error: (message: string) => page(<ErrorView message={localizeMessage(message)}/>),
  dialogs: (props: ComponentProps<typeof DialogsView>) => page(<DialogsView {...props}/>),
  dialog: (props: ComponentProps<typeof DialogView>) => page(<DialogView {...props}/>),
  editor: (props: ComponentProps<typeof ChecklistEditor>) => page(<ChecklistEditor {...props}/>),
  appeals: (props: ComponentProps<typeof AppealsView>) => page(<AppealsView {...props}/>),
  rows(rows: DialogRecord[], selected: Set<string>, totalRows: number, filters: Filters) {
    slot('dialog-rows', <DialogRows rows={rows} selected={new Set(selected)}/>);
    slot('active-filters', <ActiveFilters filters={{ ...filters }}/>);
    slot('list-selection', <SelectionSummary count={selected.size}/>);
    slot('list-empty', totalRows
      ? <EmptyState title={t('Ничего не найдено')} text={t('Измените запрос или сбросьте фильтры.')} actions={<button className="btn" data-action="reset-filters">{t('Сбросить фильтры')}</button>}/>
      : <EmptyState title={t('Добавьте первый диалог')} text={t('Импортируйте набор по group_id или загрузите транскрипт в JSON.')} actions={<button className="btn btn-primary" data-action="import">{t('Импорт набора')}</button>}/>);
  },
  scale: (scale?: Scale | null) => slot('scale-preview', <ScalePreview scale={scale}/>),
  editorErrors: (errors: string[]) => slot('editor-errors', <div className="notice error rule">{errors.map((error, index) => <div key={index}>{error}</div>)}</div>),
  review: (props: ComponentProps<typeof ReviewForm>) => slot(`review-${props.appeal.id}`, <MotionFrame kind="modal"><ReviewForm {...props}/></MotionFrame>),
  reviewMessage: (id: string, message: string, error = false) => slot(`review-${id}`, <p className={error ? 'danger' : 'muted'} role="status">{localizeMessage(message)}</p>),
  audioLoading: () => slot('audio-block', <p className="muted small" role="status">{t('Получаем свежую ссылку на запись…')}</p>),
  audio: (url: string, demo: boolean) => slot('audio-block', <><label className="small">{t(demo ? 'Учебный звуковой сигнал, не запись разговора' : 'Запись разговора')}</label><audio id="call-audio" controls preload="metadata" src={url}/><p className="audio-caption">{t('Кнопка доказательства перематывает запись. Автовоспроизведение отключено.')}</p><button className="text-btn" data-action="refresh-audio">{t('Обновить ссылку')}</button></>),
  audioError: (message: string) => slot('audio-block', <><p className="danger small">{localizeMessage(message)}</p><button className="btn btn-small" data-action="audio">{t('Повторить загрузку')}</button></>),
  modal(title: string, data: ModalProps) {
    mount('modal-content', <MotionFrame kind="modal" key={++revision}><div className="modal-heading"><h2 id="modal-title">{t(title)}</h2><button className="icon-btn" data-action="close-modal" aria-label={t('Закрыть окно')}><Icon name="close"/></button></div><ModalContents data={data}/></MotionFrame>);
  },
  toast: (message: string, error = false) => mount('notifications', <MotionFrame kind="toast" key={++revision}><div className={`toast ${error ? 'error' : ''}`}><span className="toast-symbol" aria-hidden="true"><Icon name={error ? 'alert' : 'circleCheck'}/></span><span>{localizeMessage(message)}</span></div></MotionFrame>),
  clearToast: () => mount('notifications', null),
  job: (completed: number, total: number) => mount('job-banner', <><strong>{t('Оценка диалогов')}</strong> · {t('{completed} из {total}', { completed, total })}<progress aria-label={t('Прогресс оценки')} max={total} value={completed}/></>),
  jobFailed: () => mount('job-banner', <><span className="danger">{t('Оценка завершилась с ошибкой. Обновите диалоги и проверьте сервер.')}</span> <button className="text-btn" data-action="retry">{t('Обновить диалоги')}</button></>),
  jobRetry: (id: string, message?: string) => mount('job-banner', <><span className={message ? 'danger' : ''}>{message ? t('Не удалось получить результат задания. {message}', { message: localizeMessage(message) }) : t('Задание ещё выполняется.')}</span> <button className="text-btn" data-resume-job={id}>{t(message ? 'Проверить ещё раз' : 'Проверить прогресс')}</button></>),
};

export function disposeUI() {
  flushSync(() => { roots.forEach(root => root.unmount()); roots.clear(); clearSlots(); });
  disposeMotion();
}
