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
    <div className="border-border bg-background sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t px-5 py-3 backdrop-blur-sm">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="border-border bg-card text-foreground hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors"
            type="button"
          >
            <Wand2 aria-hidden className="text-primary size-3.5" />
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
                <span className="text-sm font-medium">{preset.name}</span>
                <span className="text-muted-foreground text-xs">
                  {preset.description}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        className="border-border bg-card text-foreground hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors"
        onClick={() => setStack(randomStackPatch())}
        title="Random stack"
        type="button"
      >
        <Shuffle aria-hidden className="text-primary size-3.5" />
        Random
      </button>

      <button
        className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] transition-colors"
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
