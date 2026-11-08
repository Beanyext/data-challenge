import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { AppealsView, ChecklistEditor } from '../react/forms';
import type { Appeal } from '../react/types';
import { setLocale } from '../react/i18n';

const fixture = (): Appeal => ({
  id: 'synthetic-appeal', evaluation_id: 'synthetic-evaluation', conversation_id: 'synthetic-dialog',
  criterion_id: 'clarity', criterion_title: 'Ясность <правила>', status: 'open',
  comment: 'Проверьте <script>не код</script> и символы & «кавычки».', total: 0,
  criterion: { criterion_id: 'clarity', answer: 'no', points: 0, effective_weight: 20,
    explanation: 'Обоснование: реплика [2].', evidence: [{ turn: 1, quote: 'Учебная реплика' }] },
  fragment: [{ turn: 1, speaker: 'operator', text: 'Учебная реплика' }],
});
const render = (appeals: Appeal[], filter: 'all' | 'open' = 'open') => new JSDOM(renderToStaticMarkup(<AppealsView appeals={appeals} filter={filter} turnCounts={{ 'synthetic-dialog': 4 }}/>)).window.document;

test('appeal summary retains the dispute and comment while evidence starts collapsed and remains accessible', () => {
  const appeal = fixture();
  const document = render([appeal]);
  const details = document.querySelector<HTMLDetailsElement>('.appeal-evidence')!;
  assert.equal(details.open, false);
  assert.equal(details.id, `appeal-evidence-${appeal.id}`);
  assert.equal(details.querySelector('summary')!.textContent, 'Обоснование и фрагмент');
  assert.match(details.querySelector('.appeal-reason')!.textContent!, /Обоснование: реплика № 2/);
  assert.equal(details.querySelector('[data-fragment-turn]')!.getAttribute('data-fragment-turn'), '1');
  assert.match(details.querySelector('.appeal-fragment li.is-evidence')!.textContent!, /Учебная реплика/);
  assert.equal(document.querySelector('.appeal-statement p')!.textContent, appeal.comment);
  assert.equal(document.querySelector('.appeal-statement')!.closest('details'), null);
  assert.equal(document.querySelector('[data-review]')!.closest('details'), null);
  assert.match(document.querySelector('.appeal-dispute')!.textContent!, /баллы 0 из 20.*итог диалога 0/);
  assert.equal(document.querySelector('script'), null, 'supplied text is escaped');
  details.open = true;
  assert.equal(details.querySelector('.appeal-fragment')!.textContent!.includes('Учебная реплика'), true);
});

test('only shortened messages offer a direct route to the full message in every interface language', () => {
  const appeal = fixture();
  appeal.fragment = [
    { turn: 1, speaker: 'operator', text: 'К'.repeat(200) },
    { turn: 3, speaker: 'client', text: 'Қ'.repeat(201) },
  ];
  try {
    for (const [locale, caption] of [['ru', 'Перейти к полной реплике'], ['en', 'Go to the full message'], ['kk', 'Толық репликаға өту']] as const) {
      setLocale(locale);
      const document = render([appeal]);
      const links = document.querySelectorAll('.appeal-full-turn');
      assert.equal(links.length, 1, 'the 200-character message is complete and needs no extra link');
      assert.equal(links[0].getAttribute('data-context'), appeal.id);
      assert.equal(links[0].getAttribute('data-context-turn'), '3');
      assert.match(links[0].getAttribute('aria-label')!, /4/);
      assert.ok(links[0].textContent!.includes(caption));
      assert.match(document.getElementById(`appeal-${appeal.id}-turn-3`)!.querySelector('.appeal-fragment-text')!.textContent!, /…$/);
      assert.equal(document.querySelector('script'), null);
    }
  } finally { setLocale('ru'); }
});

test('missing fragments are explained and completed decisions remain visible in all appeals', () => {
  const appeal = fixture();
  appeal.status = 'changed';
  appeal.decision = { answer: 'yes', reason: 'Учебная проверка: ответ найден.' };
  appeal.fragment = [];
  const document = render([appeal], 'all');
  assert.match(document.querySelector('.appeal-evidence')!.textContent!, /нет фрагмента/);
  assert.equal(document.querySelector('.appeal-fragment'), null);
  assert.equal(document.querySelector('.appeal-decision p')!.textContent, appeal.decision.reason);
  assert.equal(document.querySelector('.appeal-decision')!.closest('details'), null);
  assert.equal(document.querySelector('[data-review]'), null, 'completed decisions cannot be reviewed again');
  assert.equal(document.querySelector('.appeal-actions [data-context]')!.getAttribute('data-context'), appeal.id);
  assert.equal(render([appeal]).querySelector('.appeal-card'), null, 'open filter excludes completed appeals');
});

test('add criterion button sits above the criteria list so a long checklist needs no scrolling', () => {
  setLocale('ru');
  const criteria = Array.from({ length: 12 }, (_, index) => ({ id: `c${index + 1}`, section_id: 's', title: `Критерий ${index + 1}`, description: 'Синтетическое правило', answer_type: 'binary' as const, weight: 5 }));
  const checklist = { id: 'cl', version: 1, name: 'Синтетический чек-лист', sections: [{ id: 's', name: 'Раздел' }], criteria };
  const document = new JSDOM(renderToStaticMarkup(<ChecklistEditor checklist={checklist} checklists={[checklist]} criterionIndex={0} dirty={false}/>)).window.document;
  const navigation = document.querySelector('.checklist-navigation')!;
  const button = navigation.querySelector('[data-action="add-criterion"]')!;
  const list = navigation.querySelector('.editor-list')!;
  assert.equal(navigation.querySelectorAll('[data-action="add-criterion"]').length, 1);
  assert.ok(button.compareDocumentPosition(list) & 4, 'button comes before the list');
  assert.equal(list.querySelectorAll('[data-criterion-index]').length, 12);
});
