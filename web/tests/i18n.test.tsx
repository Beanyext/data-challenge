import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { catalog, getLocale, setLocale, translate, readLocale, persistLocale, LANGUAGE_KEY, formatNumber } from '../react/i18n';
import { DialogsWorkspace } from '../react/pages';
import { ChecklistWorkspace } from '../react/forms';
import { Modal } from '../react/shared';
import type { Api } from '../react/types';
import { EvaluationView } from '../react/result';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';

test('all interface translations contain complete English/Kazakh parameters and static keys', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [source, translated] of Object.entries(catalog)) {
    for (const locale of ['en','kk'] as const) {
      assert.ok(translated[locale].trim(), `${source}: ${locale}`);
      assert.deepEqual(placeholders(translated[locale]), placeholders(source), `${source}: placeholders ${locale}`);
      assert.ok(!translated[locale].includes('???'));
    }
  }
  const nativeNames = new Set(['Русский','Қазақша','ҚАЗ']);
  for (const filename of readdirSync('web/react').filter(file => file.endsWith('.tsx'))) {
    const source = ts.createSourceFile(filename, readFileSync(`web/react/${filename}`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if ((ts.isStringLiteral(node) || ts.isJsxText(node)) && /[А-Яа-яЁё]/.test(node.text)) {
        const text = node.text.trim();
        assert.ok(nativeNames.has(text) || Object.hasOwn(catalog, text), `Uncatalogued text in ${filename}: ${text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

test('each locale renders translated UI and preserves supplied content', () => {
  const checklist = { id:'cl',version:1,name:'Пользовательский чек-лист',sections:[{id:'s',name:'Мой раздел'}],criteria:[{id:'c',section_id:'s',title:'Мой критерий',description:'Не изменять правило',answer_type:'binary' as const,weight:10}] };
  const evaluation = {id:'e',total:87.5,criteria:[{criterion_id:'c',answer:'yes' as const,explanation:'Объяснение сервера',evidence:[{turn:0,quote:'Исходная цитата'}]}]};
  try {
    for (const [locale, heading, totalLabel] of [['ru','Диалоги','Итоговый балл'],['en','Conversations','Total score'],['kk','Диалогтар','Жалпы ұпай']] as const) {
      setLocale(locale);
      const noop=()=>{};
      const list = renderToStaticMarkup(<DialogsWorkspace rows={[]} appeals={[]} state={{filters:{query:'draft',channel:'',language:'',status:''},queue:'all',summaryScope:'filtered',selected:new Set()}} onState={noop} busy={false} onEvaluate={noop} onOpenDialog={noop} onImport={noop} onUpload={noop} onSubmission={noop}/>);
      assert.ok(list.includes(heading));
      const result = renderToStaticMarkup(<EvaluationView evaluation={evaluation} checklist={checklist} dialog={{conversation_id:'d',channel:'agent chat',language:'RU',transcript:[{speaker:'client',text:'Исходная цитата'}]}}/>);
      assert.ok(result.includes(totalLabel), `${locale}: total label`);
      assert.ok(result.includes('Исходная цитата') && result.includes('Объяснение сервера') && result.includes('Мой критерий'));
      const editor = renderToStaticMarkup(<ChecklistWorkspace active api={{} as Api} checklists={[checklist]} onSaved={noop} notify={noop} onDirtyChange={noop}/>);
      assert.ok(editor.includes('Пользовательский чек-лист') && editor.includes('Не изменять правило'));
      const modal = renderToStaticMarkup(<Modal title="Мой критерий" onClose={noop}><textarea defaultValue="Пользовательский черновик"/></Modal>);
      assert.ok(modal.includes('Мой критерий'));
      assert.equal(formatNumber(87.5), locale === 'en' ? '87.5' : '87,5');
    }
  } finally { setLocale('ru'); }
});

test('live language selection persists without navigation and preserves route and query', () => {
  setLocale('ru');
  const values = new Map();
  const storage = { getItem: (key: string) => values.get(key), setItem: (key: string,value: string) => { values.set(key,value); } };
  const destination=persistLocale('kk',{currentUrl:'http://localhost/?demo=1#checklists',storage});
  assert.equal(getLocale(),'kk');
  assert.equal(values.get(LANGUAGE_KEY),'kk');
  assert.equal(new URL(destination).hash,'#checklists');
  assert.equal(new URL(destination).searchParams.get('demo'),'1');
  assert.equal(readLocale(destination,storage),'kk');
  assert.equal(readLocale('http://localhost/',storage),'kk');
  assert.equal(readLocale('http://localhost/?lang=en',storage),'en');
  assert.equal(readLocale('http://localhost/?lang=invalid',{getItem:()=> 'invalid'}),'ru');
  assert.equal(readLocale('http://localhost/?lang=en',{getItem:()=>{throw new Error('storage blocked');}}),'en');
  const fallback=persistLocale('en',{currentUrl:'http://localhost/#appeals',storage:{setItem:()=>{throw new Error('blocked');}}});
  assert.equal(getLocale(),'en');
  assert.equal(new URL(fallback).searchParams.get('lang'),'en');
  assert.equal(new URL(fallback).hash,'#appeals');
  setLocale('ru');
});
