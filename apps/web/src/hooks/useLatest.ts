import { useFn } from "./useFn";

export const useLatest = <T>(value: T) => useFn(() => value);
