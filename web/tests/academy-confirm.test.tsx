import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AcademyConfirm, confirmAcademy, type AcademyConfirmOptions } from '../react/academy/AcademyConfirm';

const labels: AcademyConfirmOptions = {
  title: 'Покинуть тренировку?', message: 'Прогресс останется в этом браузере.',
  confirmLabel: 'Выйти', cancelLabel: 'Продолжить тренировку',
};

async function environment(run: (context: {
  window: JSDOM['window']; root: Root; opener: HTMLButtonElement;
  open: (options?: AcademyConfirmOptions) => Promise<{ pending: Promise<boolean>; dialog: HTMLDialogElement }>;
}) => Promise<void>, strict = false) {
  const dom = new JSDOM('<button id="opener" type="button">Open</button><div id="host"></div>', { url: 'http://localhost/#academy', pretendToBeVisual: true });
  const { window } = dom;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, Event: window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  // jsdom does not implement the browser's top layer. Stub only that platform API;
  // the production component still calls showModal/close, never a simulated overlay.
  window.HTMLDialogElement.prototype.showModal = function () {
    assert.equal(this.open, false, 'a fresh native modal is opened once');
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
  const root = createRoot(window.document.querySelector('#host')!);
  const opener = window.document.querySelector<HTMLButtonElement>('#opener')!;
  let unmounted = false;
  const nativeUnmount = root.unmount.bind(root);
  root.unmount = () => { if (!unmounted) { unmounted = true; nativeUnmount(); } };
  try {
    await act(async () => { root.render(strict ? <StrictMode><AcademyConfirm/></StrictMode> : <AcademyConfirm/>); });
    opener.focus();
    async function open(options = labels) {
      let pending!: Promise<boolean>;
      await act(async () => { pending = confirmAcademy(options); });
      const dialog = window.document.querySelector<HTMLDialogElement>('dialog')!;
      assert.ok(dialog?.open);
      return { pending, dialog };
    }
    await run({ window, root, opener, open });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test('Academy confirmation: missing host cancels immediately', async () => {
  assert.equal(await confirmAcademy(labels), false);
});

test('Academy confirmation: native modal, accessible labels and cancel-first focus', async () => {
  await environment(async ({ window, opener, open }) => {
    const { pending, dialog } = await open();
    assert.equal(window.document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent, labels.title);
    assert.equal(window.document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent, labels.message);
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(window.document.activeElement, dialog.querySelector('.ac-confirm-cancel'));
    for (const button of dialog.querySelectorAll('button')) assert.equal(button.type, 'button');
    await act(async () => { dialog.querySelector<HTMLButtonElement>('.ac-confirm-cancel')!.click(); });
    assert.equal(await pending, false);
    assert.equal(window.document.activeElement, opener);
    assert.equal(window.document.querySelector('dialog'), null);
  });
});

test('Academy confirmation: accepting resolves once and restores prior focus', async () => {
  await environment(async ({ window, opener, open }) => {
    const { pending, dialog } = await open({ ...labels, danger: true });
    assert.ok(dialog.classList.contains('ac-confirm-danger'));
    let resolutions = 0;
    pending.then(() => { resolutions++; });
    const accept = dialog.querySelector<HTMLButtonElement>('.ac-confirm-accept')!;
    await act(async () => { accept.click(); accept.click(); });
    assert.equal(await pending, true);
    assert.equal(resolutions, 1);
    assert.equal(window.document.activeElement, opener);
  });
});

test('Academy confirmation: native Escape cancel event resolves false', async () => {
  await environment(async ({ window, open }) => {
    const { pending, dialog } = await open();
    const escapeCancel = new window.Event('cancel', { cancelable: true });
    await act(async () => { dialog.dispatchEvent(escapeCancel); });
    assert.equal(escapeCancel.defaultPrevented, true);
    assert.equal(await pending, false);
  });
});

test('Academy confirmation: duplicate prompts share the existing decision', async () => {
  await environment(async ({ open }) => {
    const { pending, dialog } = await open();
    let duplicate!: Promise<boolean>;
    await act(async () => { duplicate = confirmAcademy({ ...labels, title: 'Do not replace the active prompt' }); });
    assert.equal(duplicate, pending);
    assert.equal(dialog.querySelector('h2')?.textContent, labels.title);
    await act(async () => { dialog.querySelector<HTMLButtonElement>('.ac-confirm-cancel')!.click(); });
    assert.equal(await duplicate, false);
  });
});

test('Academy confirmation: unmount cancels, closes and clears the subscriber', async () => {
  await environment(async ({ root, opener, window, open }) => {
    const { pending, dialog } = await open();
    await act(async () => { root.unmount(); });
    assert.equal(await pending, false);
    assert.equal(dialog.open, false);
    assert.equal(window.document.activeElement, opener);
    assert.equal(await confirmAcademy(labels), false);
  });
});

test('Academy confirmation: disconnected prior focus and late close cannot cancel the next prompt', async () => {
  await environment(async ({ window, opener, open }) => {
    const first = await open();
    opener.remove();
    await act(async () => { first.dialog.querySelector<HTMLButtonElement>('.ac-confirm-accept')!.click(); });
    assert.equal(await first.pending, true);
    const next = await open({ ...labels, title: 'Следующее действие' });
    await act(async () => { first.dialog.dispatchEvent(new window.Event('close')); });
    assert.equal(next.dialog.open, true);
    await act(async () => { next.dialog.querySelector<HTMLButtonElement>('.ac-confirm-cancel')!.click(); });
    assert.equal(await next.pending, false);
  });
});

test('Academy confirmation: labels are literal text and all locales come from callers', async () => {
  await environment(async ({ open }) => {
    for (const values of [labels, { title: 'Жаттығудан шығу керек пе?', message: 'Прогресс сақталады.', confirmLabel: 'Шығу', cancelLabel: 'Жалғастыру' }, { title: 'Leave training?', message: '<img src=x onerror=alert(1)>', confirmLabel: 'Leave', cancelLabel: 'Keep training' }]) {
      const { pending, dialog } = await open(values);
      assert.equal(dialog.querySelector('h2')?.textContent, values.title);
      assert.equal(dialog.querySelector('p')?.textContent, values.message);
      assert.equal(dialog.querySelector('.ac-confirm-accept')?.textContent, values.confirmLabel);
      assert.equal(dialog.querySelector('.ac-confirm-cancel')?.textContent, values.cancelLabel);
      assert.equal(dialog.querySelector('img'), null);
      await act(async () => { dialog.querySelector<HTMLButtonElement>('.ac-confirm-cancel')!.click(); });
      assert.equal(await pending, false);
    }
  }, true);
});

test('Academy confirmation: native dialog failure cancels safely', async () => {
  await environment(async ({ window }) => {
    window.HTMLDialogElement.prototype.showModal = () => { throw new Error('No modal top layer'); };
    let pending!: Promise<boolean>;
    await act(async () => { pending = confirmAcademy(labels); });
    assert.equal(await pending, false);
    assert.equal(window.document.querySelector('dialog'), null);
  });
});
