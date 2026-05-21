import { createFileRoute } from "@tanstack/react-router";
import { StackBuilder } from "@/components/stack-builder/stack-builder";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/new")({
  component: StackBuilderPage,
});

function StackBuilderPage() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-border border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">t-stack</span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
            stack builder
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <a
            className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
            href="https://github.com/timothygithinji/t-stack"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </header>
      <StackBuilder />
    </div>
  );
}
