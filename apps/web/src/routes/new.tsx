import { createFileRoute } from "@tanstack/react-router";
import { StackBuilder } from "@/components/stack-builder/stack-builder";

export const Route = createFileRoute("/new")({
  component: StackBuilderPage,
});

function StackBuilderPage() {
  return (
    <div className="flex h-screen flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="flex items-center justify-between border-[var(--color-border)] border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">t-stack</span>
          <span className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
            stack builder
          </span>
        </div>
        <a
          className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide hover:text-[var(--color-foreground)]"
          href="https://github.com/timothygithinji/t-stack"
          rel="noreferrer"
          target="_blank"
        >
          GitHub
        </a>
      </header>
      <StackBuilder />
    </div>
  );
}
