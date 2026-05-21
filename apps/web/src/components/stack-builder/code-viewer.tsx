import { useEffect, useState } from "react";
import type { RenderedFile } from "@t-stack/templating/in-memory";
import {
  type HighlightLine,
  highlightToTokens,
} from "@/lib/stack-builder/highlight";

interface CodeViewerProps {
  file: RenderedFile | null;
}

export function CodeViewer({ file }: CodeViewerProps) {
  const [lines, setLines] = useState<HighlightLine[] | null>(null);

  useEffect(() => {
    if (!file) {
      setLines(null);
      return;
    }
    let cancelled = false;
    highlightToTokens(file.path, file.content)
      .then((result) => {
        if (!cancelled) {
          setLines(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLines(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!file) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[var(--color-muted-foreground)] text-sm">
        Pick a file from the tree to preview it.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-[var(--color-border)] border-b px-3 py-2">
        <span className="truncate font-mono text-[11px]" title={file.path}>
          {file.path}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase">
          {file.sourcePath !== file.path ? "rendered" : "verbatim"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117] pt-3">
        {lines ? (
          <pre className="font-mono text-xs leading-relaxed">
            <code>
              {lines.map((line, lineIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: shiki tokens have no stable id
                <div className="px-3" key={lineIdx}>
                  {line.length === 0 ? "\n" : null}
                  {line.map((tok, tokIdx) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: shiki tokens have no stable id
                      key={tokIdx}
                      style={tok.color ? { color: tok.color } : undefined}
                    >
                      {tok.content}
                    </span>
                  ))}
                </div>
              ))}
            </code>
          </pre>
        ) : (
          <pre className="px-3 py-3 font-mono text-[var(--color-foreground)] text-xs">
            <code>{file.content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
