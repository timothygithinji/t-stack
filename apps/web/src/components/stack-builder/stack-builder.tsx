import { initSchema } from "@t-stack/schema";
import { useMemo } from "react";
import { useStackBuilder } from "@/lib/stack-builder/use-stack-builder";
import { asInitDecisions } from "@/lib/stack-builder/types";
import { CommandOutput } from "./command-output";
import { FieldRenderer } from "./field-renderer";
import { PresetCards } from "./preset-cards";
import { ShareButton } from "./share-button";

export function StackBuilder() {
  const {
    stack,
    setStack,
    applyPreset,
    command,
    copyCommand,
    copied,
    copyShareUrl,
    shareCopied,
    resetStack,
  } = useStackBuilder();

  // Live-validate against the Zod schema to surface inline errors. We only
  // surface the projectName error today (it's the one regex-validated input);
  // other fields use type-narrowed inputs that can't go invalid.
  const projectNameError = useMemo(() => {
    const result = initSchema.safeParse(asInitDecisions(stack));
    if (result.success) {
      return null;
    }
    const projectIssue = result.error.issues.find(
      (i) => i.path[0] === "projectName"
    );
    return projectIssue?.message ?? null;
  }, [stack]);

  return (
    <div className="grid h-[calc(100vh-3.25rem)] grid-cols-1 overflow-hidden sm:grid-cols-[28rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col overflow-y-auto border-[var(--color-border)] border-r">
        <div className="space-y-6 p-5">
          <section className="space-y-2">
            <h2 className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
              Pick an archetype
            </h2>
            <PresetCards onSelect={applyPreset} selected={stack.archetype} />
          </section>

          <section className="space-y-2">
            <h2 className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
              Configure
            </h2>
            <FieldRenderer
              projectNameError={projectNameError}
              setStack={setStack}
              stack={stack}
            />
          </section>

          <button
            className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide hover:text-[var(--color-foreground)]"
            onClick={resetStack}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-[var(--color-border)] border-b px-5 py-3">
          <h2 className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
            Output
          </h2>
          <ShareButton copied={shareCopied} onCopy={copyShareUrl} />
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <CommandOutput
            command={command}
            copied={copied}
            onCopy={copyCommand}
          />
          <div className="mt-5 rounded-lg border border-[var(--color-border)] border-dashed bg-[var(--color-muted)] p-5 text-[var(--color-muted-foreground)] text-sm">
            <p className="font-mono text-[10px] uppercase tracking-wide">
              File preview
            </p>
            <p className="mt-2 text-xs">
              Live template rendering lands in the next commit — it'll show the
              directory tree and rendered contents for the current selections,
              with placeholders for vars that resolve from
              <span className="font-mono"> orgs.toml </span>at scaffold time.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
