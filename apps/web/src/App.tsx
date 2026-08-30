import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "@rossetta/shared";
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

  if (me.isLoading) return <div className="center muted">加载中…</div>;
  if (me.isError || me.data === undefined) return <Login />;

  const seg = route.replace(/^#/, "").split("/").filter(Boolean);

  let page: React.ReactNode;
  if (seg[0] === "session" && seg[1]) page = <SessionView sessionId={seg[1]} />;
  else if (seg[0] === "projects") page = <ProjectBoard />;
  else if (seg[0] === "repo" && seg[1]) page = <ProjectBoard repoId={Number(seg[1])} />;
  else if (seg[0] === "task" && seg[1]) page = <TaskReview taskId={Number(seg[1])} />;
  else page = <SessionList />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">rossetta</span>
        <nav>
          <a href="#/sessions">会话</a>
          <a href="#/projects">项目 / 任务</a>
        </nav>
      </header>
      <main>{page}</main>
    </div>
  );
}
