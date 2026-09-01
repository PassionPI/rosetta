import { useCallback, useRef } from "react";

export type AnyFunc<A extends unknown[], R> = (...args: A) => R;

const useFn = <A extends unknown[], R>(fn: AnyFunc<A, R>): AnyFunc<A, R> => {
  const fnRef = useRef<AnyFunc<A, R>>(fn);

  fnRef.current = fn;

  return useCallback((...args: A): R => fnRef.current(...args), []);
};

export { useFn };
