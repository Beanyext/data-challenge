import { useLayoutEffect, useRef, type ReactNode } from 'react';

const active = new Set<Animation>();
const easing = 'cubic-bezier(.22,.75,.25,1)';
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function animateElement(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | undefined {
  if (!motionAllowed() || typeof element.animate !== 'function' || !element.isConnected) return;
  const animation = element.animate(frames, { duration: 220, easing, ...options });
  active.add(animation);
  const release = () => active.delete(animation);
  animation.addEventListener('finish', release, { once: true });
  animation.addEventListener('cancel', release, { once: true });
  return animation;
}
export function stopMotion() { active.forEach(animation => animation.cancel()); active.clear(); }

export function MotionFrame({ children, subtle = false, kind = 'page' }: { children: ReactNode; subtle?: boolean; kind?: 'page' | 'modal' | 'toast' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!motionAllowed()) return;
    const running: Animation[] = [];
    const frame = requestAnimationFrame(() => {
      const scope = ref.current;
      if (!scope) return;
      let elements: Element[];
      if (kind !== 'page') elements = Array.from(scope.children);
      else if (subtle) elements = Array.from(scope.querySelectorAll('.checklist-configuration, .appeal-queue, #evaluation-panel'));
      else elements = Array.from(scope.querySelectorAll('[data-reveal]')).filter(node => !node.parentElement?.closest('[data-reveal]'));
      elements.slice(0, 10).forEach((element, index) => {
        const animation = animateElement(element, [
          { opacity: .55, transform: `translateY(${subtle ? 3 : kind === 'modal' ? 8 : 6}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: subtle ? 160 : 240, delay: subtle ? 0 : Math.min(index * 28, 112), fill: 'backwards' });
        if (animation) running.push(animation);
      });
    });
    return () => { cancelAnimationFrame(frame); running.forEach(animation => animation.cancel()); };
  }, [kind, subtle]);
  return <div ref={ref} className="react-surface">{children}</div>;
}

// Motion observes existing interactions, never delays or replaces their handlers.
export function installInteractionMotion() {
  const preference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const onPreference = () => { if (preference?.matches) stopMotion(); };
  const onToggle = (event: Event) => {
    if (!(event.target instanceof HTMLDetailsElement) || !event.target.open) return;
    const content = Array.from(event.target.children).filter(child => child.tagName !== 'SUMMARY');
    content.slice(0, 6).forEach(child => animateElement(child, [{ opacity: .5, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180 }));
  };
  const onEvidence = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>('[data-turn]');
    if (!button || !/^\d+$/.test(button.dataset.turn ?? '')) return;
    const target = document.getElementById(`turn-${button.dataset.turn}`);
    if (target) animateElement(target, [{ boxShadow: '0 0 0 5px rgb(30 143 94 / 23%)' }, { boxShadow: '0 0 0 0 rgb(30 143 94 / 0%)' }], { duration: 520 });
  };
  preference?.addEventListener('change', onPreference);
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('click', onEvidence);
  window.addEventListener('pagehide', stopMotion);
  return () => {
    stopMotion();
    preference?.removeEventListener('change', onPreference);
    document.removeEventListener('toggle', onToggle, true);
    document.removeEventListener('click', onEvidence);
    window.removeEventListener('pagehide', stopMotion);
  };
}
