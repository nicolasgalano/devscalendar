import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

import { markdownSanitizeSchema } from "./sanitize";

/**
 * Render sanitizado de markdown. Server-safe: no requiere `"use client"`,
 * puede vivir dentro de un Server Component sin bundling extra al cliente.
 *
 * `content === ""` (o null) renderiza un placeholder discreto en vez de nada
 * — lo espera la vista de detalle del ticket cuando la descripción está
 * vacía, y así no aparece un hueco sin explicación.
 *
 * Los links se abren en pestaña nueva con `rel="noopener noreferrer"` — la
 * primera parte es UX, la segunda es seguridad contra reverse tabnabbing.
 * `remark-gfm` habilita autolinks, tablas, task lists y strikethrough.
 * `rehype-sanitize` con el schema local descarta cualquier cosa que no esté
 * explícitamente permitida.
 */
export function MarkdownViewer({
  content,
  className,
}: {
  content: string | null | undefined;
  className?: string;
}) {
  if (!content || content.trim() === "") {
    return (
      <p className={cn("text-muted-foreground text-ui italic", className)}>
        Sin descripción
      </p>
    );
  }

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-medium prose-headings:text-emphasis",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:text-foreground",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
