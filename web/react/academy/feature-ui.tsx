import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { getLocale } from '../i18n';
import type { AcademyState, Localized, Mission, Mode } from './types';

export const tr = (ru: string, kk: string, en: string): string => ({ ru, kk, en })[getLocale()];
export const localized = (value: Localized): string => value[getLocale()];
export const isMissionAvailable = (state: AcademyState, mission: Mission): boolean =>
  state.demoUnlocked || state.mastered.includes(mission.id) || state.mastered.length >= mission.unlock;
export const missionLink = (id: string, mode: Mode = 'story'): string =>
  `#academy/mission/${encodeURIComponent(id)}/${mode}`;

/** A local, optional dialog. Opening it never starts or updates a mission. */
export function FeatureDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (typeof element.close === 'function' && element.open) element.close();
      previous?.isConnected && previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="ac-feature-dialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close.current(); }}>
    <div className="ac-feature-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="ac-button ac-ghost" onClick={onClose} aria-label={tr('Закрыть', 'Жабу', 'Close')} data-ac-dialog-close>×</button></div>
    {children}
  </dialog>;
}
