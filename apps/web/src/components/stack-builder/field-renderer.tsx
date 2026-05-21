import {
  evaluateField,
  fieldMeta,
  initSchema,
  isFieldVisible,
  type ValueAvailability,
} from "@t-stack/schema";
import { Terminal } from "lucide-react";
import { useMemo } from "react";
import {
  CATEGORIES,
  type CategoryDef,
  type GroupedField,
  type SelectOption,
} from "@/lib/stack-builder/categories";
import { enumChoicesForField } from "@/lib/stack-builder/schema-helpers";
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
 * categories. Field visibility (`docs` only when `structure=monorepo`,
 * `hookdeckApiKey` only when `hookdeck=true`) is read straight from each
 * field's registered `visibleIf` predicate, so adding a new conditional
 * field in the schema needs zero changes here.
 *
 * Per-value compat (e.g. "D1 requires Cloudflare + sqlite") is evaluated
 * via `evaluateField` from the schema. Disabled options stay clickable in
 * the DOM (for focus order) but render with reduced opacity and a tooltip
 * containing the reason.
 */
export function FieldRenderer({
  stack,
  setStack,
  projectNameError,
}: FieldRendererProps) {
  return (
    <div>
      {CATEGORIES.map((category) => {
        if (!shouldShowCategory(category, stack)) {
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

function shouldShowCategory(category: CategoryDef, stack: DraftStack): boolean {
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

      {category.variant === "single" && category.field && category.options ? (
        <SingleSelectGrid
          field={category.field}
          options={category.options}
          setStack={setStack}
          stack={stack}
        />
      ) : null}

      {category.variant === "multiselect" &&
      category.field &&
      category.options ? (
        <MultiSelectGrid
          field={category.field}
          options={category.options}
          setStack={setStack}
          stack={stack}
        />
      ) : null}

      {category.variant === "grouped" && category.fields ? (
        <div className="flex flex-col gap-4 px-5 py-4">
          {category.fields.map((group) => (
            <GroupedSubSection
              group={group}
              key={group.field}
              setStack={setStack}
              stack={stack}
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

/**
 * Look up per-value availability for a given field name. Falls back to
 * "everything enabled" when the field isn't registered (free-text fields,
 * or the multi-select `addons` array — both still flow through this for
 * consistency).
 */
function useFieldAvailability(
  fieldName: string,
  stack: DraftStack
): {
  visible: boolean;
  availability: Map<string, ValueAvailability>;
} {
  return useMemo(() => {
    const schema = (initSchema.shape as Record<string, unknown>)[fieldName];
    if (!schema) {
      return { visible: true, availability: new Map() };
    }
    const meta = fieldMeta.get(schema as never);
    if (!meta) {
      return { visible: true, availability: new Map() };
    }
    const visible = isFieldVisible(meta, stack);
    const enumValues = enumChoicesForField(schema as never) ?? [];
    const items = evaluateField(meta, enumValues, stack);
    return {
      visible,
      availability: new Map(items.map((item) => [item.value, item])),
    };
  }, [fieldName, stack]);
}

interface SingleSelectGridProps {
  field: string;
  options: SelectOption[];
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
}

function SingleSelectGrid({
  field,
  options,
  stack,
  setStack,
}: SingleSelectGridProps) {
  const { visible, availability } = useFieldAvailability(field, stack);
  if (!visible) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2">
      {options.map((opt) => {
        const status = availability.get(opt.value);
        const disabled = status ? !status.enabled : false;
        return (
          <OptionCard
            description={opt.description}
            disabled={disabled}
            disabledReason={disabled ? status?.reason : undefined}
            icon={opt.icon}
            key={opt.value}
            label={opt.label}
            onClick={() => {
              if (disabled) {
                return;
              }
              setStack({
                [field]: opt.value,
              } as unknown as Partial<DraftStack>);
            }}
            selected={
              (stack as unknown as Record<string, unknown>)[field] === opt.value
            }
          />
        );
      })}
    </div>
  );
}

interface GroupedSubSectionProps {
  group: GroupedField;
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
}

function GroupedSubSection({ group, stack, setStack }: GroupedSubSectionProps) {
  const { visible, availability } = useFieldAvailability(group.field, stack);
  if (!visible) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="block font-mono text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-wide">
        {group.title}
      </span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {group.options.map((opt) => {
          const status = availability.get(opt.value);
          const disabled = status ? !status.enabled : false;
          return (
            <OptionCard
              description={opt.description}
              disabled={disabled}
              disabledReason={disabled ? status?.reason : undefined}
              icon={opt.icon}
              key={opt.value}
              label={opt.label}
              onClick={() => {
                if (disabled) {
                  return;
                }
                setStack({
                  [group.field]: opt.value,
                } as unknown as Partial<DraftStack>);
              }}
              selected={
                (stack as unknown as Record<string, unknown>)[group.field] ===
                opt.value
              }
            />
          );
        })}
      </div>
    </div>
  );
}

interface MultiSelectGridProps {
  field: string;
  options: SelectOption[];
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
}

function MultiSelectGrid({
  field,
  options,
  stack,
  setStack,
}: MultiSelectGridProps) {
  const { visible, availability } = useFieldAvailability(field, stack);
  if (!visible) {
    return null;
  }
  const current = ((stack as unknown as Record<string, unknown>)[field] ??
    []) as string[];
  return (
    <div className="grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-2">
      {options.map((opt) => {
        const status = availability.get(opt.value);
        const disabled = status ? !status.enabled : false;
        const selected = current.includes(opt.value);
        return (
          <OptionCard
            description={opt.description}
            disabled={disabled}
            disabledReason={disabled ? status?.reason : undefined}
            icon={opt.icon}
            key={opt.value}
            label={opt.label}
            onClick={() => {
              if (disabled) {
                return;
              }
              const next = selected
                ? current.filter((v) => v !== opt.value)
                : [...current, opt.value];
              setStack({ [field]: next } as unknown as Partial<DraftStack>);
            }}
            selected={selected}
          />
        );
      })}
    </div>
  );
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
    <div className="flex flex-col gap-3">
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
