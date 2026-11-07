import { Icon } from './shared';
import { translate as t } from './i18n';
import type { Filters } from './types';

export type Density = 'comfortable' | 'compact';
const DENSITY_KEY = 'cqa-table-density';
export function readDensity(): Density {
  try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; }
  catch { return 'comfortable'; }
}
export function DensitySwitch({ value, onChange }: { value: Density; onChange: (value: Density) => void }) {
  function choose(density: Density) {
    onChange(density);
    try { localStorage.setItem(DENSITY_KEY, density); } catch { /* Works for this view when storage is unavailable. */ }
  }
  return <div className="density-control" role="group" aria-label={t('Плотность таблицы')}>
    <button type="button" aria-pressed={value === 'comfortable'} onClick={() => choose('comfortable')}><span className="density-icon density-icon-comfortable" aria-hidden="true" />{t('Обычный')}</button>
    <button type="button" aria-pressed={value === 'compact'} onClick={() => choose('compact')}><span className="density-icon density-icon-compact" aria-hidden="true" />{t('Компактный')}</button>
  </div>;
}

export function ActiveFilters({ filters, onRemove, onReset }: { filters: Filters; onRemove?:(key:keyof Filters)=>void; onReset?:()=>void }) {
  const channels: Record<string, string> = { 'agent chat': t('Чаты'), 'voice call': t('Звонки') };
  const languages: Record<string, string> = { RU: t('Русский'), KZ: t('Қазақша'), EN: t('English') };
  const statuses: Record<string, string> = { completed: t('С оценкой'), pending: t('Без оценки'), gross: t('Грубая ошибка'), review:t('Нужна проверка'), appeal:t('Открытая апелляция') };
  const entries: { key: keyof Filters; label: string; value: string }[] = [
    { key: 'query', label: t('Поиск'), value: filters.query },
    { key: 'channel', label: t('Канал'), value: channels[filters.channel] || filters.channel },
    { key: 'language', label: t('Язык'), value: languages[filters.language] || filters.language },
    { key: 'status', label: t('Статус'), value: statuses[filters.status] || filters.status },
  ];
  const active = entries.filter(entry => entry.value);
  if (!active.length) return null;
  return <div className="active-filters" role="group" aria-label={t('Применённые фильтры')}>
    <span className="active-filters-label">{t('Фильтры')}</span>
    {active.map(entry => <button type="button" className="filter-chip" key={entry.key} data-clear-filter={entry.key} aria-label={t('Убрать фильтр: {name}', { name: `${entry.label}: ${entry.value}` })} title={`${entry.label}: ${entry.value}`} onClick={()=>onRemove?.(entry.key)}><span>{entry.label}: <strong>{entry.value}</strong></span><Icon name="close" /></button>)}
    <button type="button" className="text-btn clear-filters" data-action="reset-filters" onClick={onReset}>{t('Сбросить всё')}</button>
  </div>;
}

export function SelectionSummary({ count, onClear }: { count: number; onClear?:()=>void }) {
  return <div className={`selection-summary ${count ? 'has-selection' : ''}`}>
    <span className="selection-count" aria-live="polite">{count ? t('Выбрано: {count}', { count }) : t('Выберите диалоги для оценки')}</span>
    {count > 0 && <button type="button" className="text-btn" data-action="clear-selection" onClick={onClear}>{t('Снять выбор')}</button>}
  </div>;
}
