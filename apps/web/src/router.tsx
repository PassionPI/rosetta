import { me } from "@/api/auth.ts";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from "@/api/notifications.ts";
import Login from "@/pages/Login.tsx";
import ProjectBoard from "@/pages/ProjectBoard.tsx";
import SessionList from "@/pages/SessionList.tsx";
import SessionView from "@/pages/SessionView.tsx";
import TaskReview from "@/pages/TaskReview.tsx";
import { wsClient } from "@/ws/client.ts";
import type { NotificationDTO, TaskDTO, WsServerMessage } from "@rosetta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { Bell, FolderGit2, MessagesSquare } from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { defineActionHandler, useAction } from "@/hooks/useAction";
import { unreadAtom } from "@/store/unread.ts";

interface BellState {
  open: boolean;
}

interface BellActions {
  toggle: boolean;
}

/** 右上角通知中心（md 需求 #8）：需用户确认/知悉的事件汇集，点击跳详情 */
function NotificationCenter() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { count } = unreadAtom.useSelector();

  const [state, actions] = useAction(
    (): BellState => ({ open: false }),
    defineActionHandler<BellState, BellActions>({
      toggle: (s, v) => {
        s.open = v;
      },
    }),
  );

  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications({ limit: 50 }).unwrap(),
    enabled: state.open,
  });

  const openItem = async (n: NotificationDTO) => {
    if (!n.read) {
      void markNotificationRead(n.id);
      unreadAtom.set((s) => ({ count: Math.max(0, s.count - 1) }));
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    actions.toggle(false);
    if (n.taskId != null) void navigate({ to: "/task/$taskId", params: { taskId: String(n.taskId) } });
    else if (n.sessionId) void navigate({ to: "/session/$sessionId", params: { sessionId: n.sessionId } });
  };

  const readAll = async () => {
    await markAllNotificationsRead().unwrap().catch(() => null);
    unreadAtom.set(() => ({ count: 0 }));
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <Dialog open={state.open} onOpenChange={actions.toggle}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="size-4" />
          {count > 0 && (
            <Badge className="absolute -top-0.5 -right-0.5 min-w-4 justify-center border-destructive/60 bg-destructive px-1 text-[10px] text-destructive-foreground">
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[70vh] max-w-md">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <DialogTitle>通知</DialogTitle>
            <DialogDescription>需确认/知悉的事件</DialogDescription>
          </div>
          {(list.data ?? []).some((n) => !n.read) && (
            <Button variant="outline" size="sm" onClick={() => void readAll()}>
              全部已读
            </Button>
          )}
        </DialogHeader>
        <ScrollArea className="max-h-[52vh] pr-3">
          <div className="space-y-1.5">
            {list.isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
            {!list.isLoading && (list.data ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无通知</p>
            )}
            {(list.data ?? []).map((n) => (
              <button
                key={n.id}
                onClick={() => void openItem(n)}
                className={`block w-full rounded-lg border p-2.5 text-left transition-colors hover:border-primary/50 ${
                  n.read ? "opacity-60" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{n.title}</p>
                    {n.detail && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.detail}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function RootLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => me().unwrap(),
    retry: false,
  });

  // WS → 缓存精确更新（md 需求 #1：setQueryData 零请求零闪烁，替代 invalidate）
  useEffect(() => {
    if (meQuery.data === undefined) return;
    return wsClient.on((msg: WsServerMessage) => {
      if (msg.kind === "task_update") {
        queryClient.setQueryData(["task", msg.task.id], msg.task);
        queryClient.setQueryData<TaskDTO[]>(["tasks", msg.task.repoId], (old) => {
          if (!old) return old;
          return old.some((t) => t.id === msg.task.id)
            ? old.map((t) => (t.id === msg.task.id ? msg.task : t))
            : [...old, msg.task];
        });
        // slot 状态变化需要 repos（不在 task 详情页查询，无闪烁体感）
        void queryClient.invalidateQueries({ queryKey: ["repos"] });
      } else if (msg.kind === "notification") {
        unreadAtom.set((s) => ({ count: s.count + 1 }));
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    });
  }, [meQuery.data, queryClient]);

  // 初始未读数
  useEffect(() => {
    if (meQuery.data === undefined) return;
    void unreadNotificationCount()
      .unwrap()
      .then(({ count }) => unreadAtom.set(() => ({ count })))
      .catch(() => {});
  }, [meQuery.data]);

  useEffect(() => {
    if (meQuery.data !== undefined) wsClient.connect();
  }, [meQuery.data]);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isTaskRoute = pathname.startsWith("/task");

  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  if (meQuery.isError || meQuery.data === undefined) return <Login />;

  const navCls =
    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
  const navActive = "bg-accent text-foreground";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="flex items-center gap-6 px-4 py-3">
          <span className="text-base font-bold tracking-widest">rosetta</span>
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/sessions" className={navCls} activeProps={{ className: navActive }}>
              <MessagesSquare className="size-4" /> 会话
            </Link>
            <Link to="/projects" className={navCls} activeProps={{ className: navActive }}>
              <FolderGit2 className="size-4" /> 项目 / 任务
            </Link>
          </nav>
          <div className="ml-auto">
            <NotificationCenter />
          </div>
        </div>
      </header>
      {/* 任务页全幅左右布局，其余页面常规容器 */}
      <main className={isTaskRoute ? "" : "mx-auto max-w-5xl px-4 pb-16 pt-5"}>
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/sessions" });
  },
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionList,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session/$sessionId",
  component: function SessionPage() {
    const { sessionId } = sessionDetailRoute.useParams();
    return <SessionView sessionId={sessionId} />;
  },
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: () => <ProjectBoard />,
});

const repoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repo/$repoId",
  component: function RepoPage() {
    const { repoId } = repoDetailRoute.useParams();
    return <ProjectBoard repoId={Number(repoId)} />;
  },
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/task/$taskId",
  component: function TaskPage() {
    const { taskId } = taskDetailRoute.useParams();
    return <TaskReview taskId={Number(taskId)} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute,
  sessionDetailRoute,
  projectsRoute,
  repoDetailRoute,
  taskDetailRoute,
]);

export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
