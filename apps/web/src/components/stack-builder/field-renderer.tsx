import { Terminal } from "lucide-react";
import { CATEGORIES, type CategoryDef } from "@/lib/stack-builder/categories";
import type { DraftStack } from "@/lib/stack-builder/types";
import { cn } from "@/lib/utils";
import { OptionCard } from "./option-card";

interface FieldRendererProps {
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  projectNameError: string | null;
}

/**
 * Render the schema-driven form as visual selection cards organised into
 * categories (Archetype, Database, Environments, Add-ons). Free-text fields
 * sit in the top "Project" section as inputs. Hidden sections (e.g. Database
 * when archetype=monorepo-cf) drop out via visibleIf.
 */
export function FieldRenderer({
  stack,
  setStack,
  projectNameError,
}: FieldRendererProps) {
  return (
    <div>
      {CATEGORIES.map((category) => {
        if (!shouldShow(category, stack)) {
          return null;
        }
        return (
          <CategorySection
            category={category}
            key={category.key}
            projectNameError={projectNameError}
            setStack={setStack}
            stack={stack}
          />
        );
      })}
    </div>
  );
}

function shouldShow(category: CategoryDef, stack: DraftStack): boolean {
  if (!category.visibleIf) {
    return true;
  }
  return Object.entries(category.visibleIf).every(
    ([k, v]) => (stack as unknown as Record<string, unknown>)[k] === v
  );
}

interface CategorySectionProps {
  category: CategoryDef;
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  projectNameError: string | null;
}

function CategorySection({
  category,
  stack,
  setStack,
  projectNameError,
}: CategorySectionProps) {
  return (
    <section>
      <header className="flex h-12 shrink-0 items-center gap-2 border-[var(--color-border)] border-b px-5">
        <Terminal
          aria-hidden
          className="size-3.5 text-[var(--color-primary)]"
        />
        <h2 className="font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
          {category.title}
        </h2>
      </header>

      {category.variant === "input" ? (
        <div className="px-5 py-4">
          <ProjectInputs
            projectNameError={projectNameError}
            setStack={setStack}
            stack={stack}
          />
        </div>
      ) : null}

      {category.variant === "single" && category.options ? (
        <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2">
          {category.options.map((opt) => (
            <OptionCard
              description={opt.description}
              disabled={isDisabled(category, opt.value, stack)}
              disabledReason={disabledReason(category, opt.value, stack)}
              icon={opt.icon}
              key={opt.value}
              label={opt.label}
              onClick={() => {
                if (!category.field) {
                  return;
                }
                setStack({
                  [category.field]: opt.value,
                } as unknown as Partial<DraftStack>);
              }}
              selected={
                category.field
                  ? (stack as unknown as Record<string, unknown>)[
                      category.field
                    ] === opt.value
                  : false
              }
            />
          ))}
        </div>
      ) : null}

      {category.variant === "toggle-group" && category.toggles ? (
        <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2">
          {category.toggles.map((tog) => {
            const value = Boolean(
              (stack as unknown as Record<string, unknown>)[tog.field]
            );
            return (
              <OptionCard
                description={tog.description}
                icon={tog.icon}
                key={tog.field}
                label={tog.label}
                onClick={() =>
                  setStack({
                    [tog.field]: !value,
                  } as unknown as Partial<DraftStack>)
                }
                selected={value}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function isDisabled(
  category: CategoryDef,
  value: string,
  stack: DraftStack
): boolean {
  // Turso requires the solo-cf-worker archetype. We hide the Database
  // section entirely on monorepo-cf via visibleIf, but the guard stays as
  // a belt-and-braces measure in case the URL ever forces an invalid combo.
  if (
    category.key === "database" &&
    value === "turso" &&
    stack.archetype !== "solo-cf-worker"
  ) {
    return true;
  }
  return false;
}

function disabledReason(
  category: CategoryDef,
  value: string,
  stack: DraftStack
): string | undefined {
  if (isDisabled(category, value, stack)) {
    return "Turso is only supported with the solo-cf-worker archetype.";
  }
  return;
}

interface ProjectInputsProps {
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  projectNameError: string | null;
}

function ProjectInputs({
  stack,
  setStack,
  projectNameError,
}: ProjectInputsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <TextField
        error={projectNameError}
        hint="my-app"
        label="Project name"
        onChange={(v) => setStack({ projectName: v })}
        value={stack.projectName}
      />
      <TextField
        hint="your-org-slug"
        label="Org"
        onChange={(v) => setStack({ org: v })}
        value={stack.org}
      />
      <TextField
        hint="my-app.example.com"
        label="Domain"
        onChange={(v) => setStack({ domain: v })}
        value={stack.domain}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  hint,
  onChange,
  error,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <label className="space-y-1.5">
      <span className="block font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
        {label}
      </span>
      <input
        className={cn(
          "w-full rounded-md border bg-[var(--color-card)] px-2.5 py-1.5 font-mono text-sm focus:outline-none",
          error
            ? "border-[var(--color-destructive)]"
            : "border-[var(--color-border)] focus:border-[var(--color-primary)]"
        )}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        type="text"
        value={value}
      />
      {error ? (
        <p className="text-[var(--color-destructive)] text-xs">{error}</p>
      ) : null}
    </label>
  );
}
