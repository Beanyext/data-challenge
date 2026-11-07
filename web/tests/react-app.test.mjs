import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('built React interface preserves selection, filters, forms, evidence and appeal workflow', async () => {
  const html = await readFile('web/index.html', 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:8765/?demo=1', pretendToBeVisual: true });
  const { window } = dom;
  const saved = new Map();
  const timers = new Set();
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const trackedSetTimeout = (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timers.add(timer); return timer;
  };
  const trackedClearTimeout = timer => { timers.delete(timer); nativeClearTimeout(timer); };
  for (const name of ['window','document','navigator','location','history','localStorage','sessionStorage','Element','HTMLElement','HTMLDetailsElement','HTMLInputElement','FormData','Event','MouseEvent','MutationObserver','getComputedStyle']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: window[name], writable: true, configurable: true });
  }
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  for (const [name, value] of Object.entries({ matchMedia: window.matchMedia, requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout, confirm: () => true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  const q = selector => window.document.querySelector(selector);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(condition, message) {
    for (let i = 0; i < 100; i++) { if (condition()) return; await sleep(20); }
    assert.fail(message);
  }
  function change(selector, value, type = 'change') {
    const element = q(selector); assert.ok(element, selector);
    element.value = value; element.dispatchEvent(new window.Event(type, { bubbles: true }));
  }
  let uiModule;
  try {
    await import('../app.mjs');
    uiModule = await import('../react-ui.js');
    await until(() => q('#dialog-rows')?.children.length === 6, 'initial six rows');
    const firstCheckbox = q('[data-select]');
    firstCheckbox.click();
    assert.equal(q('#evaluate-selected').disabled, false);
    assert.equal(q('[data-select]').checked, true);
    assert.match(q('#evaluate-selected').textContent, /1/);
    q('#select-all').click();
    assert.equal(window.document.querySelectorAll('[data-select]:checked').length, 6);
    q('#select-all').click();
    assert.equal(window.document.querySelectorAll('[data-select]:checked').length, 0);

    change('[data-filter="language"]', 'KZ');
    assert.ok(q('#dialog-rows').children.length > 0 && q('#dialog-rows').children.length < 6);
    change('#search-dialogs', 'definitely-no-match', 'input');
    assert.equal(q('#dialog-rows').children.length, 0);
    assert.equal(q('#list-empty').hidden, false);
    assert.equal(q('#search-dialogs').value, 'definitely-no-match');
    q('[data-action="reset-filters"]').click();
    assert.equal(q('#dialog-rows').children.length, 6);
    assert.equal(q('[data-filter="channel"]').options.length, 3);
    q('[data-open]').click();
    await until(() => q('#evaluation-panel'), 'dialog opens');
    assert.ok(q('.result-score'));
    q('[data-turn]').click();
    assert.ok(q('.turn.highlight'));
    const criterionId = q('[data-appeal]').dataset.appeal;
    q('[data-appeal]').click();
    assert.ok(q('#modal').open);
    change('#appeal-form textarea', 'Проверка React: учтите контекст диалога', 'input');
    q('#appeal-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => q(`[data-appeal="${criterionId}"]`)?.disabled, 'appeal is stored and reflected');

    window.location.hash = 'appeals';
    await until(() => q('[data-review]'), 'appeal queue opens');
    q('[data-review]').click();
    await until(() => q('[data-decision]'), 'review form loads');
    q('[name="decision-status"][value="changed"]').click();
    assert.equal(q('select[name="answer"]').disabled, false);
    change('[name="reason"]', 'Контекст проверен', 'input');
    q('[data-decision]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => q('.appeal-queue') && !q('[data-review]'), 'review stored');
    q('[data-appeal-filter="all"]').click();
    assert.match(q('.appeal-queue').textContent, /Контекст проверен/);

    window.location.hash = 'checklists';
    await until(() => q('.checklist-configuration'), 'editor opens');
    const title = q('[data-criterion="title"]');
    const expectedTitle = title.value + ' — React';
    change('[data-criterion="title"]', expectedTitle, 'input');
    assert.match(q('#dirty-label').textContent, /Есть изменения/);
    change('[data-criterion="answer_type"]', 'scale', 'input');
    assert.equal(q('[data-criterion="title"]').value, expectedTitle);
    change('[data-criterion="steps"]', '0 | Нет\n7 | Частично\n10 | Полностью', 'input');
    assert.equal(q('#scale-preview tbody').children.length, 3);
    assert.match(q('#scale-preview').textContent, /Частично/);
    assert.equal(q('[data-criterion="steps"]').value, '0 | Нет\n7 | Частично\n10 | Полностью');
    q('[data-criterion-index="1"]').click();
    q('[data-criterion-index="0"]').click();
    assert.equal(q('[data-criterion="title"]').value, expectedTitle);
    q('[data-action="save-checklist"]').click();
    await until(() => q('#dirty-label')?.textContent === 'Сохранено', 'checklist saved');
    assert.equal(q('[data-criterion="title"]').value, expectedTitle);
    assert.equal(q('#editor-errors').textContent, '');

    q('[data-action="settings"]').click();
    assert.ok(q('#settings-form'));
    assert.equal(new window.FormData(q('#settings-form')).get('mode'), 'demo');
    q('[data-action="close-modal"]').click();
    assert.equal(q('#modal').open, false);

    window.location.hash = 'dialogs';
    await until(() => q('#dialog-rows')?.children.length === 6, 'return to dialogs');
    change('[data-filter="channel"]', 'voice call');
    q('[data-open]').click();
    await until(() => q('#audio-block'), 'voice dialog opens');
    q('[data-action="audio"]').click();
    await until(() => q('#call-audio'), 'audio player mounts in React slot');
    assert.match(q('#call-audio').src, /^data:audio\//);
    q('[data-action="refresh-audio"]').click();
    await until(() => q('#call-audio'), 'audio refresh retains valid React ownership');
    q('[data-action="evaluate-dialog"]').click();
    assert.ok(q('#evaluate-form'));
    q('[name="confirm"]').click();
    q('#evaluate-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !q('#job-banner').hidden, 'job progress appears');
    assert.ok(q('#job-banner progress'));
    await until(() => q('#job-banner').hidden && q('#evaluation-panel'), 'job completes and React result returns');
  } finally {
    uiModule?.disposeUI();
    window.close();
    timers.forEach(nativeClearTimeout);
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
