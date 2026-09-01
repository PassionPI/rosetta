import { produce } from "immer";
import { useCallback, useSyncExternalStore } from "react";

// Batch tool
type VoidFn = () => void;
type Atom<T> = {
  get(): T;
  set(setter: (val: T) => T): void;
  listen(fn: VoidFn): () => void;
};

function atom<T>(init: () => T): Atom<T> {
  const ctx = {
    state: init(),
    listeners: new Set<VoidFn>(),
  };

  return {
    listen(fn: VoidFn) {
      ctx.listeners.add(fn);
      return () => {
        ctx.listeners.delete(fn);
      };
    },
    set(setter: (val: T) => T) {
      const old = ctx.state;
      ctx.state = produce(ctx.state, setter);
      if (!Object.is(old, ctx.state)) {
        [...ctx.listeners].forEach((fn) => fn());
      }
    },
    get() {
      return ctx.state;
    },
  };
}

export function createAtom<T>(init: () => T) {
  const { get, set, listen } = atom(init);

  function useSelector(): T;
  function useSelector<R>(selector?: (state: T) => R): R;
  function useSelector<R>(selector?: (state: T) => R): T | R {
    const sel = useCallback(selector ? () => selector(get()) : get, [selector]);
    return useSyncExternalStore<T | R>(listen, sel, sel);
  }

  return { get, set, listen, useSelector };
}
