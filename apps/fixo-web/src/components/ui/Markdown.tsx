"use client";

import ReactMarkdown from "react-markdown";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
        ),
        li: ({ children }) => <li className="text-sm">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        code: ({ children }) => (
          <code className="bg-surface-alt px-1.5 py-0.5 rounded text-xs font-mono">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="bg-surface-alt p-3 rounded-lg overflow-x-auto mb-2 text-xs">
            {children}
          </pre>
        ),
        h3: ({ children }) => (
          <h3 className="font-semibold text-sm mt-3 mb-1">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="font-medium text-sm mt-2 mb-1">{children}</h4>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
