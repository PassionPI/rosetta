# AGENTS.md

rosetta — 基于 pi agent 的 web harness（TS server + Web UI）。

- 设计文档：`md/`（架构、存储、生命周期、API、任务编排）
- 结构与约定：`md/05-structure.md`；运维脚本：`script/`

## 前端样式规范（apps/web）

1. 组件样式统一使用 **Tailwind CSS + shadcn/ui**，不引入其他样式方案
2. **禁止全局字符串类名的 CSS 文件**（如 `styles.css` 里定义 `.card` / `.msg`
   再在组件里 `className="card"` 的用法）
3. 如确需手写 CSS，**必须使用 CSS Modules**：文件名 `*.module.css`，
   `import styles from "./X.module.css"`，类名经模块哈希引用
4. 全局只允许一个 `src/index.css`：Tailwind 指令（`@import "tailwindcss"`）、
   `@theme` / shadcn CSS variables、必要的 `@plugin` 声明——不放组件类

## 前端架构规范（apps/web）

### 路由

- 统一使用 **@tanstack/react-router**（hash history），路由定义集中在 `src/router.tsx`，
  页面组件在 `src/pages/`
- 禁止手写 `location.hash` 跳转；用 `<Link to=... params=...>` / `useNavigate()`
- 路由参数通过 `xxxRoute.useParams()` 获取

### 状态

- **禁止 `useState`**。组件内状态统一 `useAction`（`src/hooks/useAction.ts`，
  immer draft + 显式 Action 类型，配套 `defineActionHandler`）
- 跨多组件共享用 `useCtx`（`createCtx` + `provider(Component, connect)`）
- **全局**状态才用 `useAtom`（`createAtom`）；不要滥用

### 请求

- 请求统一走 `src/lib/fx.ts`（tuple result + `.unwrap()`），禁止在组件内写裸
  `fetch` / 手拼 URL
- `src/api/client.ts` 用中间件创建全局 `fx` 实例（对象 body 自动补 JSON 头），
  **API 定义处直接调用 `fx()`**，不再封装 apiGet/apiPost 之类的 helper
- API 定义**集中在 `src/api/`**：每个函数显式标注输入输出类型
  （`Input` / `Output` interface + shared DTO），按域拆文件（sessions / tasks /
  repos / projects / auth）
- 组件只负责 `import` + `call`：`queryFn: () => listSessions(cwd).unwrap()`
- 服务端状态用 @tanstack/react-query 管理，不落本地 state

## 其他约定

- server：pi SDK in-process，`~/.pi/agent` 环境零定制；SQLite 仅作镜像/审计
  （pi JSONL 为事实源，见 `md/02`）
- 项目身份 = 文件夹（`realpath(cwd)`），严禁用 git 信息归并（`md/07`）
- 任务编排状态机与 git 流水线见 `md/08`（不直推 main、记录 base/endCommit）
- 相对导入带 `.ts` 扩展名；代码风格交给格式化工具，不要手工重排
