import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionReasons, failedDialogIds, filterDialogs, summarizeDialogs, reviewExcerpt, evaluationChecklist } from '../dialog-utils.mjs';

const rows = [
  { conversation_id:'a', evaluation_id:'ev-a', channel:'agent chat', language:'RU', total:80 },
  { conversation_id:'b', evaluation_id:'ev-b', channel:'voice call', language:'KZ', total:0, gross_error:true },
  { conversation_id:'c', evaluation_id:'ev-c', channel:'agent chat', language:'EN', total:null, needs_review:true },
  { conversation_id:'d', channel:'agent chat', language:'RU', total:null },
];
const appeals = [{ evaluation_id:'ev-a', criterion_id:'c1', status:'open' }, { conversation_id:'b', status:'changed' }];

test('historical evaluation never uses the latest or an unrelated checklist version', () => {
  const old={id:'qa',version:1,criteria:[]},latest={id:'qa',version:2,criteria:[]};
  const evaluation={checklist_id:'qa',checklist_version:1};
  assert.equal(evaluationChecklist(evaluation,[latest]),null);
  assert.equal(evaluationChecklist({...evaluation,checklist:latest},[latest]),null);
  assert.equal(evaluationChecklist({...evaluation,checklist:old},[latest]),old);
  assert.equal(evaluationChecklist(evaluation,[old,latest]),old);
  assert.equal(evaluationChecklist({...evaluation,checklist:{...old,criteria:null}},[latest]),null);
});

test('attention combines violations, human review and open appeals without duplicates', () => {
  assert.deepEqual(attentionReasons(rows[0], appeals), ['appeal']);
  assert.deepEqual(attentionReasons(rows[1], appeals), ['gross']);
  assert.deepEqual(attentionReasons(rows[2], appeals), ['review']);
  assert.deepEqual(filterDialogs(rows, { queue:'attention' }, appeals).map(row => row.conversation_id), ['b','c','a']);
  assert.equal(filterDialogs(rows, { queue:'attention', status:'appeal' }, appeals).length, 1);
});
test('old evaluation appeal still identifies its conversation; closed appeal is excluded', () => {
  assert.deepEqual(attentionReasons(rows[0], [{ evaluation_id:'old-ev', conversation_id:'a', status:'open' }]), ['appeal']);
  assert.deepEqual(attentionReasons(rows[0], [{ evaluation_id:'ev-a', status:'confirmed' }]), []);
});
test('filtered summaries use only selected records and distinguish zero from missing score', () => {
  const selected = filterDialogs(rows, { language:'KZ' });
  assert.deepEqual(summarizeDialogs(selected), { total:1, evaluated:1, average:0, gross:1, attention:1 });
  assert.equal(summarizeDialogs(filterDialogs(rows, {language:'none'})).average, null);
  assert.equal(summarizeDialogs(rows).evaluated, 3);
  assert.equal(summarizeDialogs(rows).average, 40);
  assert.equal(filterDialogs(rows, {status:'completed'}).length, 3);
});
test('filter combinations handle Cyrillic, special characters and do not reorder source', () => {
  const source=[...rows,{conversation_id:'я & x',language:'RU',title:'Казахский «тест» & клиент',channel:'agent chat'}];
  assert.equal(filterDialogs(source,{query:'«тест» &',language:'RU'}).length,1);
  const snapshot=JSON.stringify(source);filterDialogs(source,{queue:'attention'},appeals);
  assert.equal(JSON.stringify(source),snapshot);
});
test('review excerpt shows exact source turns and neighbors, not invented model text', () => {
  const transcript=Array.from({length:6},(_,i)=>({speaker:'operator',timestamp:`00:0${i}`,text:`Реплика ${i}`}));
  const result=reviewExcerpt({transcript},{evidence:[{turn:2,quote:'Несуществующая цитата'}]});
  assert.deepEqual(result.turns.map(turn=>turn.index),[1,2,3]);
  assert.equal(result.turns[1].text,'Реплика 2');
  assert.equal(result.turns[1].highlighted,true);
  assert.equal(result.firstTurn,2);
});
test('invalid ranges are rejected; valid range is a positive control', () => {
  const record={transcript:[{text:'one'},{text:'two'},{text:'three'}]};
  const invalid=reviewExcerpt(record,{checked_range:{from:'<img>',to:2}});
  assert.deepEqual(invalid.turns,[]);assert.equal(invalid.invalidEvidence,true);
  const valid=reviewExcerpt(record,{checked_range:{from:1,to:2}},0);
  assert.deepEqual(valid.turns.map(turn=>turn.index),[1,2]);
  assert.equal(valid.invalidEvidence,false);
});


test('retry targets only failed visible rows; pending and successful histories are preserved',()=>{
  const input=[{conversation_id:'bad-ru',language:'RU',status:'error',evaluation_id:'bad'}, {conversation_id:'bad-kz',language:'KZ',status:'error'}, {conversation_id:'ok',language:'RU',status:'done',evaluation_id:'good',total:0}, {conversation_id:'waiting',language:'RU',status:'pending',evaluation_id:'pending'}, {conversation_id:'new',language:'RU',status:'new'}];
  assert.deepEqual(failedDialogIds(filterDialogs(input,{language:'RU'})),['bad-ru']);
  assert.deepEqual(failedDialogIds(filterDialogs(input,{status:'error'})),['bad-ru','bad-kz']);
  assert.equal(filterDialogs(input,{queue:'attention'}).length,2);
  assert.equal(summarizeDialogs(input).evaluated,1);
  assert.deepEqual(failedDialogIds([]),[]);
  assert.deepEqual(failedDialogIds([input[0],input[0]]),['bad-ru']);
});
