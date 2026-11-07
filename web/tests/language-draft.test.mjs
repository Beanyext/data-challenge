import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { storeLanguageDraft, takeLanguageDraft, captureFormDrafts, restoreFormDrafts } from '../language-draft.mjs';

test('language reload draft is tab-local, single-use, route-bound and preserves raw unfinished input', () => {
  const values = new Map();
  const storage = { getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key) };
  const draft = {locale:'en',route:'#checklists',filters:{query:'draft',channel:'',language:'KZ',status:''},selected:['id'],forms:[],editor:{name:'Черновик',sections:[],criteria:[{_stepsText:'x | draft',scale:{steps:[{value:NaN,label:'draft'}]}}]}};
  assert.equal(storeLanguageDraft(draft,storage,100),true);
  const restored = takeLanguageDraft('en','#checklists',storage,110);
  assert.equal(restored.editor.criteria[0]._stepsText,'x | draft');
  assert.deepEqual(restored.selected,['id']);
  assert.equal(takeLanguageDraft('en','#checklists',storage,120),null);
  storeLanguageDraft(draft,storage,100);
  assert.equal(takeLanguageDraft('kk','#checklists',storage,110),null);
  storeLanguageDraft(draft,storage,100);
  assert.equal(takeLanguageDraft('en','#dialogs',storage,110),null);
  storeLanguageDraft(draft,storage,100);
  assert.equal(takeLanguageDraft('en','#checklists',storage,700000),null);
  assert.equal(storeLanguageDraft(draft,{setItem(){throw new Error('blocked');}}),false);
});

test('form drafts retain comments and review choices without submitting forms', () => {
  const dom = new JSDOM('<div id="modal"><form id="appeal-form"><textarea name="comment"></textarea></form></div><form data-decision="a"><input type="radio" name="decision-status" value="confirmed"><input type="radio" name="decision-status" value="changed"><select name="answer"><option value="yes">Yes</option><option value="no">No</option></select><textarea name="reason"></textarea></form>');
  const document=dom.window.document;
  document.querySelector('[name=comment]').value='Сохранить мой текст';
  document.querySelector('[value=changed]').checked=true;
  document.querySelector('[name=answer]').value='no';
  document.querySelector('[name=reason]').value='Дәлел';
  const drafts=captureFormDrafts(document);
  document.querySelector('[name=comment]').value='';
  document.querySelector('[value=confirmed]').checked=true;
  document.querySelector('[name=answer]').value='yes';
  restoreFormDrafts(drafts,document);
  assert.equal(document.querySelector('[name=comment]').value,'Сохранить мой текст');
  assert.equal(document.querySelector('[value=changed]').checked,true);
  assert.equal(document.querySelector('[name=answer]').value,'no');
  assert.equal(document.querySelector('[name=reason]').value,'Дәлел');
  dom.window.close();
});
