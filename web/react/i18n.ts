import { commonMessages } from './messages/common';
import { formsMessages } from './messages/forms';
import { pagesMessages } from './messages/pages';
import { resultMessages } from './messages/result';
import { errorMessages } from './messages/errors';
import { reviewMessages } from './messages/review';
import { uxMessages } from './messages/ux';
import { messageAnalysisMessages } from './messages/message-analysis';

export type Locale = 'ru' | 'kk' | 'en';
export const LANGUAGE_KEY = 'cqa-ui-language';
export const catalog = { ...formsMessages, ...pagesMessages, ...resultMessages, ...errorMessages, ...commonMessages, ...reviewMessages, ...uxMessages, ...messageAnalysisMessages };
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
const localeTag = () => ({ ru: 'ru-RU', kk: 'kk-KZ', en: 'en-US' }[locale]);
export function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString(localeTag(), { maximumFractionDigits: 2 }) : '—';
}
/** Fixed number of decimals in the interface language, e.g. 0,22 / 0.22. */
export function formatDecimal(value: number, min: number, max = min): string {
  return value.toLocaleString(localeTag(), { minimumFractionDigits: min, maximumFractionDigits: max });
}
/** Counted phrases. Russian keys name all three forms; English and Kazakh translations follow their own plural rules. */
export function translatePlural(count: number, forms: { one: string; few: string; many: string }, values: Record<string, string | number> = {}): string {
  let category = 'many';
  try { category = new Intl.PluralRules(localeTag()).select(count); } catch { /* Fall back to the general form. */ }
  const source = category === 'one' ? forms.one : locale === 'ru' && (category === 'few' || category === 'other') ? forms.few : forms.many;
  return translate(source, { ...values, count: formatNumber(count) });
}
export function languageUrl(value: Locale, current: string): string {
  const url = new URL(current); url.searchParams.set('lang', value); return url.href;
}
export async function reloadInLanguage(value: Locale, options: {
  beforeReload?: (locale: Locale) => boolean | Promise<boolean>;
  navigate?: (url: string) => void;
  currentUrl?: string;
  storage?: Pick<Storage, 'setItem'>;
} = {}): Promise<boolean> {
  if (value === locale) return true;
  if (options.beforeReload && !await options.beforeReload(value)) return false;
  try { (options.storage ?? window.localStorage).setItem(LANGUAGE_KEY, value); } catch { /* The URL also carries the selected locale. */ }
  const url = languageUrl(value, options.currentUrl ?? window.location.href);
  (options.navigate ?? (address => window.location.assign(address)))(url);
  return true;
}

export function localizeShell() {
  document.documentElement.lang = locale;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => { element.textContent = translate(element.dataset.i18n!); });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', translate(element.dataset.i18nAria!)); });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(element => { element.title = translate(element.dataset.i18nTitle!); });
  document.querySelector('meta[name="description"]')?.setAttribute('content', translate('CQA: оценка диалогов, доказательства и пересмотр результатов по чек-листу.'));
  document.title = `CQA · ${translate('Контроль качества')}`;
}
