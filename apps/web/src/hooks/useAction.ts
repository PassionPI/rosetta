import { produce } from "immer";
import { useMemo, useReducer } from "react";
import { useFn } from "./useFn";
import { useLatest } from "./useLatest";

type ActionPayloads = object;

type Actions<A extends ActionPayloads> = {
  [Key in keyof A]: {
    type: Key;
    payload: A[Key];
  };
}[keyof A];

type ActionHandler<S extends object, A extends ActionPayloads> = {
  [Key in keyof A]: A[Key] extends null | undefined
    ? (state: S) => void
    : (state: S, payload: A[Key]) => void;
};

type ActionDispatcher<A extends ActionPayloads> = {
  [Key in keyof A]: A[Key] extends null | undefined
    ? () => void
    : (payload: A[Key]) => void;
};

export const defineActionHandler = <S extends object, A extends ActionPayloads>(
  handlers: ActionHandler<S, A>,
) => handlers;

export const useAction = <S extends object, A extends ActionPayloads>(
  initState: () => S,
  actionHandler: ActionHandler<S, A>,
) => {
  type Action = Actions<A>;
  type Payload = A[keyof A];

  const reducer = useFn((state: S, { type, payload }: Actions<A>) =>
    produce(state, (draft) => {
      actionHandler[type](draft as S, payload);
    }),
  );

  const [state, dispatch] = useReducer(reducer, undefined, initState);

  const actions = useMemo(() => {
    const result = {} as Record<string, unknown>;
    for (const type of Object.keys(actionHandler)) {
      result[type] = (payload: Payload) =>
        dispatch({ type, payload } as Action);
    }
    return result as ActionDispatcher<A>;
  }, []);

  const getState = useLatest(state);

  const api = useMemo(() => {
    return {
      dispatch,
      getState,
    };
  }, [dispatch, getState]);

  return [state, actions, api] as const;
};
