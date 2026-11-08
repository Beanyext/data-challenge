import { useId, useState } from 'react';
import { localized, tr } from './feature-ui';
import { hintStructure } from './hint-content';
import type { DialogueNode } from './types';

export function SteppedHint({ missionId, node, hinted, busy, onUse }: { missionId: string; node: DialogueNode; hinted: boolean; busy: boolean; onUse: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [principleOpen, setPrincipleOpen] = useState(hinted);
  const id = useId();
  const structure = hintStructure(missionId, node.id);
  if (!node.actions.length) return null;
  return <div className="ac-stepped-hint">
    <button type="button" className="ac-button ac-ghost" data-ac-hint disabled={busy} aria-expanded={hinted && principleOpen} aria-controls={`${id}-principle`} onClick={() => { if (!hinted) { onUse(); setPrincipleOpen(true); } else setPrincipleOpen(value => !value); }}>{tr('Подсказка · 1 из 2', 'Көмек · 2-ден 1', 'Hint · 1 of 2')}</button>
    <div id={`${id}-principle`} hidden={!hinted || !principleOpen}>{hinted && principleOpen && <>
      <div className="ac-hint" role="note" data-ac-hint-level="1"><div><strong>{tr('1. Принцип', '1. Қағида', '1. Principle')}</strong><p>{localized(node.hint)}</p></div></div>
      {structure && <><button type="button" className="ac-button ac-secondary" disabled={busy} data-ac-hint-next aria-expanded={expanded} aria-controls={`${id}-structure`} onClick={() => setExpanded(value => !value)}>{tr('Ещё подсказка: структура ответа', 'Тағы көмек: жауап құрылымы', 'More help: response structure')}</button><div id={`${id}-structure`} hidden={!expanded}>{expanded && <div className="ac-hint ac-hint-structure" role="note" data-ac-hint-level="2"><div><strong>{tr('2. Структура ответа', '2. Жауап құрылымы', '2. Response structure')}</strong><p>{localized(structure)}</p></div></div>}</div></>}
      <small>{tr('Подсказка уже учтена для этого этапа. Выберите ответ самостоятельно.', 'Бұл кезеңдегі көмек белгіленді. Жауапты өзіңіз таңдаңыз.', 'Hint use is already recorded for this stage. Choose your own response.')}</small>
    </>}</div>
  </div>;
}
