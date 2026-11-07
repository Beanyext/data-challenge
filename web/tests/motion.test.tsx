import test from 'node:test';
import assert from 'node:assert/strict';
import { animateElement, motionAllowed, stopMotion } from '../react/motion';

test('motion respects reduced movement and missing animation support without hiding content', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let reduced = true;
  let calls = 0;
  const animation = new EventTarget() as EventTarget & { cancel: () => void };
  animation.cancel = () => animation.dispatchEvent(new Event('cancel'));
  const target = { isConnected: true, animate: () => { calls++; return animation; } } as unknown as Element;
  Object.defineProperty(globalThis, 'window', { value: { matchMedia: () => ({ matches: reduced }) }, configurable: true });
  try {
    assert.equal(motionAllowed(), false);
    assert.equal(animateElement(target, [{ opacity: .55 }, { opacity: 1 }], {}), undefined);
    assert.equal(calls, 0);
    reduced = false;
    assert.equal(motionAllowed(), true);
    assert.equal(animateElement({ isConnected: true } as Element, [], {}), undefined);
    assert.equal(animateElement({ ...target, isConnected: false } as Element, [], {}), undefined);
    animateElement(target, [{ opacity: .55 }, { opacity: 1 }], { duration: 200 });
    assert.equal(calls, 1);
    stopMotion();
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; }
});

test('cleanup cancels active animations and releases finished ones', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const animations: (EventTarget & { cancel: () => void })[] = [];
  let cancelled = 0;
  Object.defineProperty(globalThis, 'window', { value: { matchMedia: () => ({ matches: false }) }, configurable: true });
  const element = { isConnected: true, animate: () => {
    const animation = new EventTarget() as EventTarget & { cancel: () => void };
    animation.cancel = () => { cancelled++; animation.dispatchEvent(new Event('cancel')); };
    animations.push(animation); return animation;
  } } as unknown as Element;
  try {
    animateElement(element, [], {});
    animateElement(element, [], {});
    animations[0].dispatchEvent(new Event('finish'));
    stopMotion();
    assert.equal(cancelled, 1);
    stopMotion();
    assert.equal(cancelled, 1);
  } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; }
});
