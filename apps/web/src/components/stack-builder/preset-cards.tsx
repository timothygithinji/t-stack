import { PRESETS } from "@t-stack/presets";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraftStack } from "@/lib/stack-builder/types";

interface PresetCardsProps {
  selected: DraftStack["archetype"];
  onSelect: (archetype: DraftStack["archetype"]) => void;
}

export function PresetCards({ selected, onSelect }: PresetCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PRESETS.map((preset) => {
        const isActive = preset.id === selected;
        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-colors",
              "border-[var(--color-border)] hover:bg-[var(--color-accent)]",
              "focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
              isActive &&
                "border-[var(--color-primary)] bg-[var(--color-accent)] ring-1 ring-[var(--color-primary)]"
            )}
            key={preset.id}
            onClick={() => onSelect(preset.id)}
            type="button"
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="font-medium text-sm">{preset.name}</span>
              {isActive ? (
                <Check
                  aria-hidden
                  className="size-4 text-[var(--color-primary)]"
                />
              ) : null}
            </div>
            <span className="text-[var(--color-muted-foreground)] text-xs">
              {preset.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
