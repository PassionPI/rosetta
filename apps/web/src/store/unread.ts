import { createAtom } from "@/hooks/useAtom.ts";

/** 全局未读通知数（跨页面共享的全局态 → useAtom 规范的正例） */
export const unreadAtom = createAtom(() => ({ count: 0 }));
