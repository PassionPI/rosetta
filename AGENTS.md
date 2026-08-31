# AGENTS.md

rossetta — 基于 pi agent 的 web harness（TS server + Web UI）。

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

## 其他约定

- server：pi SDK in-process，`~/.pi/agent` 环境零定制；SQLite 仅作镜像/审计
  （pi JSONL 为事实源，见 `md/02`）
- 项目身份 = 文件夹（`realpath(cwd)`），严禁用 git 信息归并（`md/07`）
- 任务编排状态机与 git 流水线见 `md/08`（不直推 main、记录 base/endCommit）
- 相对导入带 `.ts` 扩展名；代码风格交给格式化工具，不要手工重排
