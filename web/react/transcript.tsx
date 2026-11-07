import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Appeal, Checklist, DialogRecord, Evaluation } from './types';
import { translate as t } from './i18n';
import { turnTime } from './text';
import { Slot } from './slots';
import { EvaluationView, type EvaluationNavigation } from './result';
import { clearLinkedEvidence } from './review-tools';
import { linkedMessageCriteria, validMessageIndex } from './message-analysis';

type WorkspacePane = 'dialog' | 'evaluation';
type PanePosition = { page: number | null; content: number };
const narrowQuery = '(max-width: 1099px)';

export function TranscriptWorkspace({ record, evaluation, checklist, appeals, demo }: { record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; appeals: Appeal[]; demo: boolean }) {
  const navigation = useRef<EvaluationNavigation>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(narrowQuery).matches);
  const [activePane, setActivePane] = useState<WorkspacePane>('dialog');
  const positions = useRef<Record<WorkspacePane, PanePosition>>({ dialog: { page: null, content: 0 }, evaluation: { page: null, content: 0 } });
  const [unlinkedTurn, setUnlinkedTurn] = useState<number | null>(null);
  const transcript = record.transcript || [];
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  useEffect(() => {
    const media = window.matchMedia?.(narrowQuery);
    if (!media) return;
    const resize = () => {
      if (media.matches && workspace.current?.querySelector('#evaluation-panel')?.contains(document.activeElement)) setActivePane('evaluation');
      setNarrow(media.matches);
    };
    resize();
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    setUnlinkedTurn(null); setActivePane('dialog'); clearLinkedEvidence();
    positions.current = { dialog: { page: null, content: 0 }, evaluation: { page: null, content: 0 } };
  }, [record.conversation_id]);
  const content = (pane: WorkspacePane) => workspace.current?.querySelector<HTMLElement>(pane === 'dialog' ? '#transcript' : '#evaluation-panel');
  const selectPane = (pane: WorkspacePane, restorePosition = true) => {
    if (!narrow || pane === activePane) return;
    positions.current[activePane] = { page: window.scrollY, content: content(activePane)?.scrollTop || 0 };
    flushSync(() => setActivePane(pane));
    const target = content(pane);
    if (target) target.scrollTop = positions.current[pane].content;
    if (restorePosition) {
      const top = positions.current[pane].page;
      if (top == null) workspace.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      else window.scrollTo({ top, behavior: 'auto' });
    }
  };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, pane: WorkspacePane) => {
    const target: WorkspacePane | null = event.key === 'Home' ? 'dialog' : event.key === 'End' ? 'evaluation' : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? pane === 'dialog' ? 'evaluation' : 'dialog' : null;
    if (!target) return;
    event.preventDefault();
    selectPane(target);
    workspace.current?.querySelector<HTMLButtonElement>(`#workspace-tab-${target}`)?.focus({ preventScroll: true });
  };
  const revealTranscript = (event: MouseEvent<HTMLElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-turn]');
    if (!button) return;
    const first = Number(button.dataset.turn), last = button.dataset.rangeEnd === undefined ? first : Number(button.dataset.rangeEnd);
    if (validMessageIndex(first, transcript.length) && validMessageIndex(last, transcript.length) && first <= last) selectPane('dialog', false);
  };
  const navigate = (index: number) => {
    clearLinkedEvidence();
    if (!linkedMessageCriteria(evaluation, index, transcript.length).length) {
      selectPane('dialog', false); setUnlinkedTurn(index); return;
    }
    selectPane('evaluation', false);
    setUnlinkedTurn(navigation.current?.revealMessage(index) ? null : index);
  };
  return <div className="split-view detail-top message-workspace" ref={workspace} data-active-pane={activePane}>
    <div className="workspace-tabs" role="tablist" aria-label={t('Диалог и оценка')} hidden={!narrow}>
      {(['dialog', 'evaluation'] as const).map(pane => <button key={pane} type="button" className="workspace-tab" id={`workspace-tab-${pane}`} role="tab" aria-selected={activePane === pane} aria-controls={pane === 'dialog' ? 'transcript-panel' : 'evaluation-panel'} tabIndex={activePane === pane ? 0 : -1} onClick={() => selectPane(pane)} onKeyDown={event => tabKey(event, pane)}>{t(pane === 'dialog' ? 'Диалог' : 'Оценка')}</button>)}
    </div>
    <section className="panel transcript-panel" id="transcript-panel" role={narrow ? 'tabpanel' : undefined} aria-labelledby={narrow ? 'workspace-tab-dialog' : undefined} hidden={narrow && activePane !== 'dialog'} data-reveal><div className="panel-heading"><h2>{t('Транскрипт')}</h2><span className="muted small">{t('{count} реплик', { count: transcript.length })}</span></div>
      {record.channel === 'voice call' && <div className="audio-block" id="audio-block"><Slot name="audio-block" fallback={<><button className="btn btn-small" data-action="audio">{t('Загрузить запись')}</button><p className="audio-caption">{t('Запись загружается по свежей ссылке.')}</p></>}/></div>}
      <div className="quiet-line">{t('Нажмите на сообщение оператора, чтобы перейти к его разбору в оценке.')}</div>
      <div className="transcript" id="transcript">{transcript.map((turn, index) => {
        const metadata = <span className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index + 1}{turnTime(turn) && ` · ${turnTime(turn)}`}</span><span className="turn-evidence-label">{t('Доказательство')}</span></span>;
        return <Fragment key={index}><article id={`turn-${index}`} className={`turn turn-${Object.hasOwn(roles, turn.speaker) ? turn.speaker : 'system'}`} tabIndex={-1}>
          {turn.speaker === 'operator' ? <button type="button" className="turn-inspect-button" data-inspect-turn={index} aria-controls="evaluation-panel" aria-label={t('Перейти к разбору сообщения оператора № {n}', { n: index + 1 })} onClick={() => navigate(index)}>{metadata}<span className="turn-text">{turn.text}</span><span className="turn-inspect-hint">{t('К разбору в оценке')}</span></button> : <>{metadata}<p>{turn.text}</p></>}
        </article>{unlinkedTurn === index && <p className="message-navigation-note" role="status">{t(evaluation ? 'В готовой оценке нет ссылки на эту реплику. Это не означает, что в ней нет ошибок.' : 'Диалог ещё не оценён. Перейти к разбору пока нельзя.')}</p>}</Fragment>;
      })}</div>
    </section>
    <section className="panel evaluation-panel" id="evaluation-panel" role={narrow ? 'tabpanel' : undefined} aria-labelledby={narrow ? 'workspace-tab-evaluation' : undefined} hidden={narrow && activePane !== 'evaluation'} onClickCapture={revealTranscript} data-reveal><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo} navigationRef={navigation}/></section>
  </div>;
}
