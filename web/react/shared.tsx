import type { ReactNode } from 'react';
import { translate as t, formatNumber } from './i18n';

const symbols: Record<string, ReactNode> = {
  'dialogs': <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 9h8M8 13h5"/></>,
  'list': <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 8 1 1 2-2m-3 7 1 1 2-2m3-5h3m-3 6h3"/></>,
  'appeal': <><path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 0 14" transform="translate(1 -2)"/></>,
  'book': <><path d="M12 7v14m0-14C8 4 5 4 2 5v14c3-1 6-1 10 2 4-3 7-3 10-2V5c-3-1-6-1-10 2Z"/></>,
  'search': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  'settings': <><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="m9 3 1-1h4l1 3 3 1 3 2-1 3v3l1 3-3 2-3 1-1 2h-4l-1-3-3-1-3-2 1-3v-3L3 7l3-2 3-1Z"/></>,
  'shield': <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  'heart': <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></>,
  'arrow-right': <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  'arrow-left': <><path d="M20 12H4m6 6-6-6 6-6"/></>,
  'check': <><path d="m5 12 4 4L19 6"/></>,
  'circleCheck': <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  'rotate': <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
  'target': <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  'upload': <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  'download': <><path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  'chart': <><path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4"/></>,
  'alert': <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.01"/></>,
  'phone': <><path d="M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C9 21 3 15 3 5a2 2 0 0 1 2-2Z"/></>,
  'close': <><path d="m6 6 12 12M6 18 18 6"/></>,
  'chevron': <><path d="m9 5 7 7-7 7"/></>,
  'rows': <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/></>,
  'filter': <><path d="M3 5h18M6 12h12M9 19h6"/></>,
  'panel-collapse': <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-12-4 4 4 4"/></>,
  'panel-expand': <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m4-12 4 4-4 4"/></>,
  'print': <><path d="M7 8V3h10v5M7 17H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-3"/><path d="M7 14h10v7H7zM17 11h1"/></>,
};
export function Icon({ name }: { name: string }) {
  return <svg className="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{symbols[name] || symbols.dialogs}</svg>;
}
export const number = formatNumber;
export const label = (value: unknown): string => t({ yes:'Да', no:'Нет', na:'N/A', open:'Открыта', confirmed:'Подтверждена', changed:'Пересмотрена', completed:'Оценён', done:'Оценён', evaluated:'Оценён', pending:'Без оценки', new:'Без оценки', queued:'В очереди', running:'В обработке', failed:'Ошибка' }[String(value)] ?? String(value ?? '—'));
export const channel = (value: string) => t(value === 'voice call' ? 'Звонок' : 'Чат');
export function EmptyState({ title, text, actions }: { title: string; text: string; actions?: ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol" aria-hidden="true"><Icon name="dialogs"/></div><h2>{title}</h2><p>{text}</p><div className="actions">{actions}</div></div>;
}
