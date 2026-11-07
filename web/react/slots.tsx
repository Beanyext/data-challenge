import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

// Small presentation slots let the existing controller update a region without
// replacing the page, losing input focus, or introducing another application store.
const values = new Map<string, ReactNode>();
const listeners = new Map<string, Set<() => void>>();
export function setSlot(name: string, value: ReactNode) {
  values.set(name, value);
  listeners.get(name)?.forEach(notify => notify());
}
export function clearSlots() {
  values.clear();
  listeners.forEach(group => group.forEach(notify => notify()));
}
export function Slot({ name, fallback = null }: { name: string; fallback?: ReactNode }) {
  const subscribe = useCallback((notify: () => void) => {
    let group = listeners.get(name);
    if (!group) { group = new Set(); listeners.set(name, group); }
    group.add(notify);
    return () => { group.delete(notify); if (!group.size) listeners.delete(name); };
  }, [name]);
  const snapshot = useCallback(() => values.get(name), [name]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <>{value === undefined ? fallback : value}</>;
}
