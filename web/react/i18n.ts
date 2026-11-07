import { commonMessages } from './messages/common';
import { formsMessages } from './messages/forms';
import { pagesMessages } from './messages/pages';
import { resultMessages } from './messages/result';
import { errorMessages } from './messages/errors';
import { rootMessages } from './messages/root';
import { workflowMessages } from './messages/workflow';
import { reviewMessages } from './messages/review';
import { submissionMessages } from './messages/submission';
import { reportMessages } from './messages/report';

export type Locale = 'ru' | 'kk' | 'en';
export const LANGUAGE_KEY = 'cqa-ui-language';
export const catalog = { ...formsMessages, ...pagesMessages, ...resultMessages, ...errorMessages, ...commonMessages, ...rootMessages, ...workflowMessages, ...reviewMessages, ...submissionMessages, ...reportMessages };
export const isLocale = (value: unknown): value is Locale => value === 'ru' || value === 'kk' || value === 'en';
export function readLocale(url: string, storage?: Pick<Storage, 'getItem'>): Locale {
  const query = new URL(url).searchParams.get('lang');
  if (isLocale(query)) return query;
  try { const saved = storage?.getItem(LANGUAGE_KEY); if (isLocale(saved)) return saved; } catch { /* Private mode still supports the URL preference. */ }
  return 'ru';
}
let locale: Locale = 'ru';
if (typeof window !== 'undefined') {
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Optional persistence. */ }
  locale = readLocale(window.location.href, storage);
}
export const getLocale = () => locale;
export function setLocale(value: Locale) { locale = value; }
export function translate(source: string, values: Record<string, string | number> = {}): string {
  const template = locale === 'ru' ? source : catalog[source]?.[locale] ?? source;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? String(values[name]) : token);
}
export function localizeMessage(message: string): string {
  const http = /^(Сервер недоступен|Не удалось выполнить запрос): HTTP (\d+)\.$/.exec(message);
  if (http) return translate(`${http[1]}: HTTP {status}.`, { status: http[2] });
  return translate(message);
}
export function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' }[locale], { maximumFractionDigits: 2 }) : '—';
}
export function languageUrl(value: Locale, current: string): string {
  const url = new URL(current); url.searchParams.set('lang', value); return url.href;
}
export function persistLocale(value: Locale, options: {
  currentUrl?: string;
  storage?: Pick<Storage, 'setItem'>;
} = {}): string {
  setLocale(value);
  try { (options.storage ?? window.localStorage).setItem(LANGUAGE_KEY, value); } catch { /* The URL also carries the selected locale. */ }
  return languageUrl(value, options.currentUrl ?? window.location.href);
}
