import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './shared';
import { getLocale, translate as t, type Locale } from './i18n';
import { animateElement } from './motion';

const languages: { code: Locale; name: string; short: string }[] = [
  { code: 'ru', name: 'Русский', short: 'RU' },
  { code: 'kk', name: 'Қазақша', short: 'ҚАЗ' },
  { code: 'en', name: 'English', short: 'EN' },
];
export function LanguageSwitcher({ onSelect }: { onSelect: (locale: Locale) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const locale = getLocale();
  const current = languages.find(language => language.code === locale)!;
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const animation = animateElement(menu.current, [{ opacity: .6, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160 });
    menu.current.querySelector<HTMLButtonElement>(`[data-language="${locale}"]`)?.focus();
    return () => animation?.cancel();
  }, [open, locale]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { trigger.current?.focus(); setOpen(false); return; }
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[data-language]') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
  }
  async function select(value: Locale) {
    if (value === locale) { close(); return; }
    setPending(true);
    try { if (!await onSelect(value)) { setPending(false); close(); } } catch { setPending(false); close(); }
  }
  return <div className="language-switcher" ref={container}>
    <button ref={trigger} className="language-trigger" type="button" aria-label={`${t('Язык интерфейса')}: ${current.name}`} title={t('Выбрать язык')} aria-haspopup="menu" aria-expanded={open} aria-controls="language-menu" disabled={pending} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <svg className="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/></svg><span>{current.short}</span><span className="language-chevron"><Icon name="chevron"/></span>
    </button>
    {open && <div className="language-popover" ref={menu} onKeyDown={onKeyDown}>
      <p className="language-heading" id="language-heading">{t('Язык интерфейса')}</p>
      <div id="language-menu" role="menu" aria-labelledby="language-heading">{languages.map(language => <button key={language.code} type="button" role="menuitemradio" aria-checked={language.code === locale} tabIndex={-1} data-language={language.code} disabled={pending} onClick={() => select(language.code)}><span lang={language.code}>{language.name}</span><span className="language-short">{language.short}</span>{language.code === locale && <Icon name="check"/>}</button>)}</div>
      <p className="language-hint" role={pending ? 'status' : undefined}>{pending ? t('Обновление…') : t('Страница обновится после выбора языка.')}</p>
    </div>}
  </div>;
}
