import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.ts";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { password });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      location.hash = "#/sessions";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h2>rossetta</h2>
        <input
          type="password"
          placeholder="密码（HARNESS_PASSWORD）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <button disabled={busy || !password}>{busy ? "登录中…" : "登录"}</button>
      </form>
    </div>
  );
}
