import { useLayoutEffect, useRef, useState } from 'react';
import { Icon, number } from './shared';
import { translate as t } from './i18n';
import { stopMotion } from './motion';
import type { Checklist, Evaluation } from './types';
import { incompleteEvaluation } from './evaluation-state';

const FOCUS_KEY = 'cqa-focus-mode';
function readFocus() {
  try { return localStorage.getItem(FOCUS_KEY) === 'true'; } catch { return false; }
}
export function FocusToggle() {
  const [enabled, setEnabled] = useState(readFocus);
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('focus-mode', enabled);
    return () => document.documentElement.classList.remove('focus-mode');
  }, [enabled]);
  function toggle() {
    const next = !enabled;
    setEnabled(next);
    try { localStorage.setItem(FOCUS_KEY, String(next)); } catch { /* The current session still works. */ }
  }
  return <button type="button" className="focus-toggle" data-focus-toggle aria-pressed={enabled} title={t(enabled ? 'Выйти из режима «Фокус»' : 'Развернуть рабочую область')} onClick={toggle}>
    <Icon name={enabled ? 'panel-expand' : 'panel-collapse'}/><span>{t('Фокус')}</span>
  </button>;
}

export function clearLinkedEvidence() {
  document.querySelectorAll('.turn.highlight, .result-criterion.evidence-selected').forEach(element => element.classList.remove('highlight', 'evidence-selected'));
}
export function goToCriteriaMap() {
  const map = document.getElementById('criteria-map');
  if (!map) return;
  map.focus({ preventScroll: true });
  map.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

export function ReviewSummary({ evaluation, checklist, onBackToMap }: { evaluation: Evaluation; checklist?:Checklist|null; onBackToMap?:()=>void }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    const workspace = bar?.closest<HTMLElement>('.dialog-workspace');
    if (!bar || !workspace) return;
    const measure = () => workspace.style.setProperty('--review-offset', `${Math.max(64, bar.getBoundingClientRect().height) + 24}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(bar);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); workspace.style.removeProperty('--review-offset'); };
  }, []);
  const criteria = Array.isArray(evaluation.criteria) ? evaluation.criteria : [];
  const incomplete = incompleteEvaluation(evaluation, checklist);
  return <aside className="review-summary" ref={ref} aria-label={t('Краткая сводка оценки')}>
    <div className="review-summary-score"><span>{t(incomplete ? 'Предварительный балл' : 'Итоговый балл')}</span><strong>{number(evaluation.total)}<span> / 100</span></strong></div>
    <div className="review-summary-statuses">
      {incomplete && <span className="badge badge-amber">{t('Нужна проверка')}</span>}
      {evaluation.total == null && !incomplete && <span className="review-summary-empty">{t('Нет применимых критериев для расчёта')}</span>}
      {evaluation.gross_error && <span className="badge badge-red"><Icon name="alert"/>{t('Грубая ошибка')}</span>}
      {!incomplete && criteria.some(item => item.needs_review) && <span className="badge badge-amber">{t('Нужна проверка')}</span>}
    </div>
    {criteria.length > 0 && <button type="button" className="btn btn-small" data-back-to-map onClick={()=>{onBackToMap?.();goToCriteriaMap();}}><Icon name="list"/>{t('К карте критериев')}</button>}
  </aside>;
}

export function PrintButton() {
  return <button type="button" className="btn" data-print-report onClick={() => { stopMotion(); window.print(); }}><Icon name="print"/>{t('Печать / PDF')}</button>;
}
