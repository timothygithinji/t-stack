import { ChevronDown, RotateCcw, Shuffle, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STACK_PRESETS, randomStackPatch } from "@/lib/stack-builder/presets";
import type { DraftStack } from "@/lib/stack-builder/types";

interface ActionsSectionProps {
  setStack: (patch: Partial<DraftStack>) => void;
  resetStack: () => void;
}

/**
 * Sticky-at-bottom toolbar row inside the sidebar: pick a preset to
 * quick-fill the form, randomize for a coherent stack, or reset to
 * defaults. Each preset only overrides the fields it cares about, so
 * project-name / org / domain stay as the user typed them.
 */
export function ActionsSection({ setStack, resetStack }: ActionsSectionProps) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-border border-t bg-background px-5 py-3 backdrop-blur-sm">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
            type="button"
          >
            <Wand2 aria-hidden className="size-3.5 text-primary" />
            Presets
            <ChevronDown aria-hidden className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" side="top">
          {STACK_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => setStack(preset.patch)}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">{preset.name}</span>
                <span className="text-muted-foreground text-xs">
                  {preset.description}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-accent"
        onClick={() => setStack(randomStackPatch())}
        title="Random stack"
        type="button"
      >
        <Shuffle aria-hidden className="size-3.5 text-primary" />
        Random
      </button>

      <button
        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={resetStack}
        title="Reset all fields"
        type="button"
      >
        <RotateCcw aria-hidden className="size-3.5" />
        Reset
      </button>
    </div>
  );
}
