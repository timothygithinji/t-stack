import { useEffect, useMemo, useState } from "react";
import type { RenderedFile } from "@t-stack/templating/in-memory";
import type { DraftStack } from "@/lib/stack-builder/types";
import { CodeViewer } from "./code-viewer";
import { FileTree } from "./file-tree";

interface PreviewPanelProps {
  stack: DraftStack;
}

/**
 * Render the live file preview. Handlebars compiles templates via dynamic
 * code generation, which the Cloudflare Workers V8 isolate forbids — so we
 * defer rendering until after hydration on the client. SSR shows a
 * placeholder.
 */
export function PreviewPanel({ stack }: PreviewPanelProps) {
  const [files, setFiles] = useState<RenderedFile[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Dynamic import so Handlebars never reaches the SSR evaluation path.
    import("@/lib/stack-builder/templates").then(({ renderProject }) => {
      if (cancelled) {
        return;
      }
      const rendered = renderProject(stack);
      setFiles(rendered);
      setSelectedPath((prev) => {
        if (prev && rendered.some((f) => f.path === prev)) {
          return prev;
        }
        return pickInitialFile(rendered);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [stack]);

  const selectedFile = useMemo(
    () => files?.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath]
  );

  if (!files) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-[var(--color-muted-foreground)] text-sm">
        Rendering template preview…
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[14rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <aside className="min-h-0 overflow-y-auto border-[var(--color-border)] border-r py-2">
        <p className="px-3 pb-1 font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
          {files.length} files
        </p>
        <FileTree
          files={files}
          onSelect={setSelectedPath}
          selectedPath={selectedPath}
        />
      </aside>
      <CodeViewer file={selectedFile} />
    </div>
  );
}

function pickInitialFile(files: RenderedFile[]): string | null {
  // Prefer README, then t-stack.config, then anything else.
  const readme = files.find((f) => /^[a-z-/]*README\.md$/i.test(f.path));
  if (readme) {
    return readme.path;
  }
  const config = files.find((f) => /t-stack\.config/.test(f.path));
  if (config) {
    return config.path;
  }
  return files[0]?.path ?? null;
}
