import { me } from "@/api/auth.ts";
import Login from "@/pages/Login.tsx";
import ProjectBoard from "@/pages/ProjectBoard.tsx";
import SessionList from "@/pages/SessionList.tsx";
import SessionView from "@/pages/SessionView.tsx";
import TaskReview from "@/pages/TaskReview.tsx";
import { wsClient } from "@/ws/client.ts";
import type { WsServerMessage } from "@rosetta/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { FolderGit2, MessagesSquare } from "lucide-react";
import { useEffect } from "react";

function RootLayout() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => me().unwrap(),
    retry: false,
  });

  // WS：task_update → 使任务相关查询失效
  useEffect(() => {
    if (meQuery.data === undefined) return;
    return wsClient.on((msg: WsServerMessage) => {
      if (msg.kind === "task_update") {
        void queryClient.invalidateQueries({ queryKey: ["repos"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["task"] });
      }
    });
  }, [meQuery.data, queryClient]);

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
            <Link
              to="/sessions"
              className={navCls}
              activeProps={{ className: navActive }}
            >
              <MessagesSquare className="size-4" /> 会话
            </Link>
            <Link
              to="/projects"
              className={navCls}
              activeProps={{ className: navActive }}
            >
              <FolderGit2 className="size-4" /> 项目 / 任务
            </Link>
          </nav>
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
