import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 会话正文 markdown 渲染（GFM：表格/删除线/任务列表），prose 暗色排版 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-pre:border prose-pre:border-border prose-pre:bg-black/40 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
