import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionCardProps {
  label: string;
  description: string;
  icon: LucideIcon;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}

/**
 * Visual selection card used inside every category section (Structure,
 * Infra, App, Data, Features, Add-ons, Tooling, Toggles). Selected state
 * shows a primary highlight and a check badge; disabled cards show a
 * muted destructive border and a reason on hover (typically a cross-field
 * incompatibility from the schema's `valueRules`, e.g. "Turso hosts SQLite").
 */
export function OptionCard({
  label,
  description,
  icon: Icon,
  selected,
  disabled = false,
  disabledReason,
  onClick,
}: OptionCardProps) {
  let stateClasses: string;
  if (selected) {
    stateClasses =
      "border-[var(--color-primary)] bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]";
  } else if (disabled) {
    stateClasses =
      "cursor-not-allowed border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 opacity-70";
  } else {
    stateClasses =
      "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-foreground)]/20 hover:bg-[var(--color-accent)]";
  }
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "group relative flex h-full w-full flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all",
        "focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
        stateClasses
      )}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      type="button"
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              selected
                ? "text-[var(--color-primary)]"
                : "text-[var(--color-muted-foreground)]"
            )}
          />
          <span className="font-medium text-sm">{label}</span>
        </div>
        {selected ? (
          <Check
            aria-hidden
            className="size-4 shrink-0 text-[var(--color-primary)]"
          />
        ) : null}
      </div>
      <p className="text-[var(--color-muted-foreground)] text-xs">
        {description}
      </p>
    </button>
  );
}
