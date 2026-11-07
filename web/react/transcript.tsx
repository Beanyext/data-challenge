import { Fragment, useEffect, useRef, useState } from 'react';
import type { Appeal, Checklist, DialogRecord, Evaluation } from './types';
import { translate as t } from './i18n';
import { turnTime } from './text';
import { Slot } from './slots';
import { EvaluationView, type EvaluationNavigation } from './result';
import { clearLinkedEvidence } from './review-tools';

export function TranscriptWorkspace({ record, evaluation, checklist, appeals, demo }: { record: DialogRecord; evaluation: Evaluation | null; checklist?: Checklist; appeals: Appeal[]; demo: boolean }) {
  const navigation = useRef<EvaluationNavigation>(null);
  const [unlinkedTurn, setUnlinkedTurn] = useState<number | null>(null);
  const transcript = record.transcript || [];
  const roles: Record<string, string> = { operator: t('Оператор'), client: t('Клиент'), bot: t('Бот'), system: t('Система') };
  useEffect(() => { setUnlinkedTurn(null); clearLinkedEvidence(); }, [record.conversation_id]);
  const navigate = (index: number) => {
    clearLinkedEvidence();
    setUnlinkedTurn(navigation.current?.revealMessage(index) ? null : index);
  };
  return <div className="split-view detail-top message-workspace">
    <section className="panel transcript-panel" data-reveal><div className="panel-heading"><h2>{t('Транскрипт')}</h2><span className="muted small">{t('{count} реплик', { count: transcript.length })}</span></div>
      {record.channel === 'voice call' && <div className="audio-block" id="audio-block"><Slot name="audio-block" fallback={<><button className="btn btn-small" data-action="audio">{t('Загрузить запись')}</button><p className="audio-caption">{t('Запись загружается по свежей ссылке.')}</p></>}/></div>}
      <div className="quiet-line">{t('Нажмите на сообщение оператора, чтобы перейти к его разбору в оценке.')}</div>
      <div className="transcript" id="transcript">{transcript.map((turn, index) => {
        const metadata = <span className="turn-meta"><strong>{roles[turn.speaker] || turn.speaker}</strong><span>№ {index + 1}{turnTime(turn) && ` · ${turnTime(turn)}`}</span><span className="turn-evidence-label">{t('Доказательство')}</span></span>;
        return <Fragment key={index}><article id={`turn-${index}`} className={`turn turn-${Object.hasOwn(roles, turn.speaker) ? turn.speaker : 'system'}`} tabIndex={-1}>
          {turn.speaker === 'operator' ? <button type="button" className="turn-inspect-button" data-inspect-turn={index} aria-controls="evaluation-panel" aria-label={t('Перейти к разбору сообщения оператора № {n}', { n: index + 1 })} onClick={() => navigate(index)}>{metadata}<span className="turn-text">{turn.text}</span><span className="turn-inspect-hint">{t('К разбору в оценке')}</span></button> : <>{metadata}<p>{turn.text}</p></>}
        </article>{unlinkedTurn === index && <p className="message-navigation-note" role="status">{t(evaluation ? 'В готовой оценке нет ссылки на эту реплику. Это не означает, что в ней нет ошибок.' : 'Диалог ещё не оценён. Перейти к разбору пока нельзя.')}</p>}</Fragment>;
      })}</div>
    </section>
    <section className="panel evaluation-panel" id="evaluation-panel" data-reveal><EvaluationView evaluation={evaluation} checklist={checklist} appeals={appeals} dialog={record} demo={demo} navigationRef={navigation}/></section>
  </div>;
}