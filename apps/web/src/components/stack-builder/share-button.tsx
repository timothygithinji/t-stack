import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareButtonProps {
  copied: boolean;
  onCopy: () => void;
}

export function ShareButton({ copied, onCopy }: ShareButtonProps) {
  return (
    <button
      aria-label="Copy shareable URL"
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] uppercase transition-colors",
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
        <Link2 aria-hidden className="size-3" />
      )}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
