import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

export interface AcademyConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

interface Confirmation {
  id: number;
  options: AcademyConfirmOptions;
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
  previousFocus: HTMLElement | null;
  dialog: HTMLDialogElement | null;
}

let current: Confirmation | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const snapshot = () => current;
const serverSnapshot = () => null;
const publish = () => { for (const listener of listeners) listener(); };

function finish(request: Confirmation, allowed: boolean): void {
  // A queued native close event from an earlier dialog cannot settle a new request.
  if (current !== request) return;
  current = null;
  const dialog = request.dialog;
  request.dialog = null;
  if (dialog?.open) {
    try { dialog.close(); }
    catch { dialog.removeAttribute('open'); }
  }
  publish();
  request.resolve(allowed);
  // Close the native modal before restoring focus: its siblings are otherwise inert.
  if (request.previousFocus?.isConnected) {
    try { request.previousFocus.focus({ preventScroll: true }); }
    catch { /* A detached browsing context must not leave the promise unsettled. */ }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && current) finish(current, false);
  };
}

/** Mount one AcademyConfirm host while guards can request confirmation. */
export function confirmAcademy(options: AcademyConfirmOptions): Promise<boolean> {
  // Duplicate clicks share one decision and never replace its text or pending resolver.
  if (current) return current.promise;
  // No invisible confirmation, native fallback, or unresolved promise without a host.
  if (typeof document === 'undefined' || listeners.size === 0) return Promise.resolve(false);
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(complete => { resolve = complete; });
  const focused = document.activeElement;
  const previousFocus = focused && typeof (focused as HTMLElement).focus === 'function'
    ? focused as HTMLElement : null;
  current = { id: ++sequence, options: { ...options }, promise, resolve, previousFocus, dialog: null };
  publish();
  return promise;
}

export function AcademyConfirm() {
  const request = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!request) return;
    const dialog = dialogRef.current;
    if (!dialog || current !== request) return;
    request.dialog = dialog;
    try {
      dialog.showModal();
      cancelRef.current?.focus({ preventScroll: true });
    } catch {
      finish(request, false);
    }
    return () => {
      if (current === request) finish(request, false);
      else if (dialog.open) dialog.close();
    };
  }, [request]);

  if (!request) return null;
  const { title, message, confirmLabel, cancelLabel, danger } = request.options;
  return <dialog
    key={request.id}
    ref={dialogRef}
    className={`ac-confirm${danger ? ' ac-confirm-danger' : ''}`}
    data-ac-confirm=""
    aria-modal="true"
    aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-message`}
    onCancel={event => { event.preventDefault(); finish(request, false); }}
    onClose={() => finish(request, false)}
  >
    <div className="ac-confirm-body">
      <h2 className="ac-confirm-title" id={`${id}-title`}>{title}</h2>
      <p className="ac-confirm-message" id={`${id}-message`}>{message}</p>
    </div>
    <div className="ac-confirm-actions">
      <button type="button" className="ac-button ac-secondary ac-confirm-cancel" ref={cancelRef} autoFocus onClick={() => finish(request, false)}>{cancelLabel}</button>
      <button type="button" className="ac-button ac-primary ac-confirm-accept" onClick={() => finish(request, true)}>{confirmLabel}</button>
    </div>
  </dialog>;
}
