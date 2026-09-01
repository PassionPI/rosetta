import { login } from "@/api/auth.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defineActionHandler, useAction } from "@/hooks/useAction";
import { ApiError } from "@/lib/fx.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

interface LoginState {
  password: string;
  error: string | null;
  busy: boolean;
}

interface LoginActions {
  setPassword: string;
  setError: string | null;
  setBusy: boolean;
}

export default function Login() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [state, actions] = useAction(
    (): LoginState => ({ password: "", error: null, busy: false }),
    defineActionHandler<LoginState, LoginActions>({
      setPassword: (s, v) => {
        s.password = v;
      },
      setError: (s, v) => {
        s.error = v;
      },
      setBusy: (s, v) => {
        s.busy = v;
      },
    }),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    actions.setBusy(true);
    actions.setError(null);
    const [err] = await login({ password: state.password });
    if (err) {
      actions.setError(
        err instanceof ApiError && err.status === 401
          ? "密码错误"
          : err.message,
      );
      actions.setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    void navigate({ to: "/sessions" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="tracking-widest">rosetta</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="HARNESS_PASSWORD"
                value={state.password}
                onChange={(e) => actions.setPassword(e.target.value)}
                autoFocus
              />
            </div>
            {state.error && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button disabled={state.busy || !state.password}>
              {state.busy ? "登录中…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
