import { useState } from 'react';
import { FeatureDialog, tr } from './feature-ui';

export type ReadingPreset = 'normal' | 'large';
export const READING_KEY = 'freedom-academy:broker:reading:v1';
let cached: ReadingPreset | undefined;
let storageWarning = false;

function readPreset(): ReadingPreset {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(READING_KEY);
    cached = raw === 'large' ? 'large' : 'normal';
    storageWarning = raw !== null && raw !== 'normal' && raw !== 'large';
  } catch { cached = 'normal'; storageWarning = true; }
  return cached;
}

export function useReadingPreset() {
  const [preset, setPreset] = useState<ReadingPreset>(readPreset);
  const [warning, setWarning] = useState(storageWarning);
  const apply = (value: ReadingPreset) => {
    cached = value;
    try { window.localStorage.setItem(READING_KEY, value); storageWarning = false; }
    catch { storageWarning = true; }
    setPreset(value); setWarning(storageWarning);
  };
  return { preset, warning, apply };
}

export function ReadingPreferences({ preset, warning, onApply }: { preset: ReadingPreset; warning: boolean; onApply: (value: ReadingPreset) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preset);
  return <>
    <button type="button" className="ac-button ac-ghost" data-ac-reading onClick={() => { setDraft(preset); setOpen(true); }}>
      <span aria-hidden="true">Aa</span> {tr('Удобство чтения', 'Оқу ыңғайлылығы', 'Reading comfort')}
    </button>
    {open && <FeatureDialog title={tr('Удобство чтения', 'Оқу ыңғайлылығы', 'Reading comfort')} onClose={() => setOpen(false)}>
      <p className="ac-muted">{tr('Размер текста и интервалы меняются только в учебных материалах Academy. Сначала посмотрите образец.', 'Мәтін өлшемі мен аралық тек Academy оқу материалдарында өзгереді. Алдымен үлгіні қараңыз.', 'Text size and spacing change only in Academy learning content. Preview the sample before applying.')}</p>
      <fieldset className="ac-reading-options"><legend>{tr('Режим чтения', 'Оқу режимі', 'Reading preset')}</legend>
        {(['normal', 'large'] as const).map(value => <label key={value} className={draft === value ? 'is-selected' : ''}><input type="radio" name="ac-reading-preset" value={value} checked={draft === value} onChange={() => setDraft(value)}/><span><strong>{value === 'normal' ? tr('Обычный', 'Қалыпты', 'Standard') : tr('Увеличенный', 'Үлкейтілген', 'Larger')}</strong><small>{value === 'normal' ? '16 px · 1.6' : '18 px · 1.8'}</small></span></label>)}
      </fieldset>
      <div className={`ac-reading-preview is-${draft}`} data-ac-reading-preview={draft}><span className="ac-kicker">{tr('Предпросмотр', 'Алдын ала қарау', 'Preview')}</span><p>{tr('Понимаю, что повторное обращение вызывает неудобство. Давайте уточним видимый статус и согласуем следующий шаг.', 'Қайта хабарласудың қолайсыздық тудыратынын түсінемін. Көрініп тұрған мәртебені нақтылап, келесі қадамды келісейік.', 'I understand that contacting support again is inconvenient. Let’s clarify the visible status and agree on the next step.')}</p><p>{tr('Объясните, что известно, и обозначьте, что ещё нужно проверить.', 'Не белгілі екенін түсіндіріп, нені тексеру керек екенін айтыңыз.', 'Explain what is known and identify what still needs checking.')}</p></div>
      {warning && <p className="ac-reading-warning" role="status">{tr('Настройка действует в этой вкладке. Сохранение в браузере недоступно или сохранённые данные повреждены.', 'Баптау осы қойындыда жұмыс істейді. Браузерге сақтау қолжетімсіз немесе сақталған дерек бүлінген.', 'The preference works in this tab. Browser storage is unavailable or the saved value is invalid.')}</p>}
      <div className="ac-feature-actions"><button type="button" className="ac-button ac-secondary" onClick={() => { setDraft('normal'); onApply('normal'); }} data-ac-reading-reset>{tr('Вернуть обычный режим', 'Қалыпты режимге қайту', 'Restore standard mode')}</button><button type="button" className="ac-button ac-primary" data-ac-reading-apply onClick={() => onApply(draft)}>{tr('Применить', 'Қолдану', 'Apply')}</button><button type="button" className="ac-button ac-ghost" onClick={() => setOpen(false)}>{tr('Готово', 'Дайын', 'Done')}</button></div>
    </FeatureDialog>}
  </>;
}
