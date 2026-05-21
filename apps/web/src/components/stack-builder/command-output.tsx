import { Check, ClipboardCopy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandOutputProps {
  command: string;
  copied: boolean;
  onCopy: () => void;
}

export function CommandOutput({ command, copied, onCopy }: CommandOutputProps) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center justify-between border-[var(--color-border)] border-b px-3 py-2">
        <p className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
          CLI command
        </p>
        <button
          aria-label="Copy command"
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] uppercase transition-colors",
            copied
              ? "bg-[var(--color-primary)]/12 text-[var(--color-primary)]"
              : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
          )}
          onClick={onCopy}
          type="button"
        >
          {copied ? (
            <Check aria-hidden className="size-3" />
          ) : (
            <ClipboardCopy aria-hidden className="size-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs">
        <code>{command}</code>
      </pre>
    </div>
  );
}
