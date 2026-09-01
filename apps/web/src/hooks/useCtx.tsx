import type { ComponentType } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

type Callback = () => void;

function identify<T>(x: T): T {
  return x;
}

export function createCtx<T extends object = object, P extends object = object>(
  useHooks: (props?: P) => T,
) {
  const initCtx = () => ({}) as T;
  const initDep = () => {
    const fns = new Set<Callback>();
    return {
      emit: () => [...fns].forEach((fn) => fn()),
      sub: (fn: Callback) => {
        fns.add(fn);
        return () => fns.delete(fn);
      },
    };
  };

  const Ctx = createContext({ current: initCtx() });
  const Dep = createContext({ current: initDep() });

  const Emitter = memo((props?: P) => {
    const dep = useContext(Dep);
    const ctx = useContext(Ctx);
    const val = useHooks(props);
    ctx.current = val;
    useLayoutEffect(dep.current.emit, [val]);
    return null;
  });

  function useSelector(): T;
  function useSelector<R>(selector: (state: T) => R): R;
  function useSelector<R>(selector?: (state: T) => R): T | R {
    const dep = useContext(Dep);
    const ctx = useContext(Ctx);
    const sel = useCallback(
      (): T | R => (selector || identify)(ctx.current),
      [selector],
    );
    return useSyncExternalStore(dep.current.sub, sel, sel);
  }

  function provider<Props extends object>(
    Component: ComponentType<Props>,
    connect?: (props: Props) => P,
  ): ComponentType<Props> {
    return (props: Props) => {
      const refDep = useRef(useMemo(initDep, []));
      const refCtx = useRef(useMemo(initCtx, []));
      const connected = connect?.(props) as P;
      return (
        <Dep.Provider value={refDep}>
          <Ctx.Provider value={refCtx}>
            <Emitter {...connected} />
            <Component {...props} />
          </Ctx.Provider>
        </Dep.Provider>
      );
    };
  }

  return {
    useSelector,
    provider,
  };
}
