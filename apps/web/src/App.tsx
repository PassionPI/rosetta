import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, MessagesSquare } from "lucide-react";
import type { WsServerMessage } from "@rosetta/shared";
import { api } from "./api/client.ts";
import { wsClient } from "./ws/client.ts";
import Login from "./pages/Login.tsx";
import SessionList from "./pages/SessionList.tsx";
import SessionView from "./pages/SessionView.tsx";
import ProjectBoard from "./pages/ProjectBoard.tsx";
import TaskReview from "./pages/TaskReview.tsx";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash || "#/sessions");
  useEffect(() => {
    const onChange = () => setHash(location.hash || "#/sessions");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/api/auth/me"),
    retry: false,
  });

  // WS：task_update → 使任务相关查询失效
  useEffect(() => {
    if (me.data === undefined) return;
    return wsClient.on((msg: WsServerMessage) => {
      if (msg.kind === "task_update") {
        void queryClient.invalidateQueries({ queryKey: ["repos"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["task"] });
      }
    });
  }, [me.data, queryClient]);

  useEffect(() => {
    if (me.data !== undefined) wsClient.connect();
  }, [me.data]);

  if (me.isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }
  if (me.isError || me.data === undefined) return <Login />;

  const seg = route.replace(/^#/, "").split("/").filter(Boolean);
  const isTaskRoute = seg[0] === "task" && !!seg[1];

  let page: React.ReactNode;
  if (seg[0] === "session" && seg[1]) page = <SessionView sessionId={seg[1]} />;
  else if (seg[0] === "projects") page = <ProjectBoard />;
  else if (seg[0] === "repo" && seg[1]) page = <ProjectBoard repoId={Number(seg[1])} />;
  else if (isTaskRoute) page = <TaskReview taskId={Number(seg[1])} />;
  else page = <SessionList />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="text-base font-bold tracking-widest">rossetta</span>
          <nav className="flex items-center gap-1 text-sm">
            <a
              href="#/sessions"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <MessagesSquare className="size-4" /> 会话
            </a>
            <a
              href="#/projects"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <FolderGit2 className="size-4" /> 项目 / 任务
            </a>
          </nav>
        </div>
      </header>
      {/* 任务页全幅左右布局（md 需求 #7），其余页面常规容器 */}
      <main className={isTaskRoute ? "pb-0" : "mx-auto max-w-5xl px-4 pb-16 pt-5"}>{page}</main>
    </div>
  );
}
