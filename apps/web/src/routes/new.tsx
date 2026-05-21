import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/new")({
  component: StackBuilderPage,
});

function StackBuilderPage() {
  return (
    <main className="min-h-screen w-full">
      <header className="border-[var(--color-border)] border-b px-6 py-4">
        <h1 className="font-mono text-[var(--color-muted-foreground)] text-sm uppercase tracking-wide">
          t-stack stack builder
        </h1>
      </header>
      <section className="px-6 py-8">
        <p className="text-[var(--color-muted-foreground)]">
          Stack builder UI lands in the next commit. The scaffolding for
          TanStack Start + Tailwind v4 + Cloudflare Workers is in place.
        </p>
      </section>
    </main>
  );
}
