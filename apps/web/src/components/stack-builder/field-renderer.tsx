import { type FieldMeta, fieldsForArchetype } from "@t-stack/schema";
import { Info, Lock } from "lucide-react";
import { enumChoicesForField } from "@/lib/stack-builder/schema-helpers";
import type { DraftStack } from "@/lib/stack-builder/types";
import { cn } from "@/lib/utils";

interface FieldRendererProps {
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  projectNameError: string | null;
}

/**
 * Iterate every field declared on the active archetype and render the
 * input matching `meta.ui`. Hidden fields (visibleIf miss) are skipped.
 * Secret fields render a read-only "set at CLI prompt" notice instead of
 * an input — they're never enterable in the browser by design.
 */
export function FieldRenderer({
  stack,
  setStack,
  projectNameError,
}: FieldRendererProps) {
  const fields = fieldsForArchetype(stack.archetype).filter((f) => {
    // org has its own input (free-text since the web has no orgs.toml).
    if (f.name === "org") {
      return true;
    }
    if (!f.meta.visibleIf) {
      return true;
    }
    return Object.entries(f.meta.visibleIf).every(
      ([k, v]) => (stack as unknown as Record<string, unknown>)[k] === v
    );
  });

  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <Field
          field={field}
          key={field.name}
          projectNameError={
            field.name === "projectName" ? projectNameError : null
          }
          setStack={setStack}
          stack={stack}
        />
      ))}
    </div>
  );
}

interface FieldProps {
  field: ReturnType<typeof fieldsForArchetype>[number];
  stack: DraftStack;
  setStack: (patch: Partial<DraftStack>) => void;
  projectNameError: string | null;
}

function Field({ field, stack, setStack, projectNameError }: FieldProps) {
  const value = (stack as unknown as Record<string, unknown>)[field.name];
  const id = `field-${field.name}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          className="font-mono text-[11px] text-[var(--color-muted-foreground)] uppercase tracking-wide"
          htmlFor={id}
        >
          {field.meta.label}
        </label>
        {field.meta.description ? (
          <DescriptionTooltip description={field.meta.description} />
        ) : null}
      </div>
      <InputForMeta
        field={field}
        id={id}
        meta={field.meta}
        setStack={setStack}
        value={value}
      />
      {field.name === "projectName" && projectNameError ? (
        <p className="text-[var(--color-destructive)] text-xs">
          {projectNameError}
        </p>
      ) : null}
    </div>
  );
}

function InputForMeta({
  field,
  meta,
  value,
  setStack,
  id,
}: {
  field: ReturnType<typeof fieldsForArchetype>[number];
  meta: FieldMeta;
  value: unknown;
  setStack: (patch: Partial<DraftStack>) => void;
  id: string;
}) {
  if (meta.secret) {
    return <SecretNotice />;
  }
  if (meta.ui === "toggle") {
    return (
      <button
        aria-pressed={Boolean(value)}
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full transition-colors",
          "border border-[var(--color-border)]",
          value ? "bg-[var(--color-primary)]" : "bg-[var(--color-muted)]"
        )}
        id={id}
        onClick={() =>
          setStack({
            [field.name]: !value,
          } as Partial<DraftStack>)
        }
        type="button"
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-5" : "translate-x-1"
          )}
        />
      </button>
    );
  }
  if (meta.ui === "select") {
    const choices = enumChoicesForField(field.schema) ?? [];
    return (
      <select
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 font-mono text-sm focus:border-[var(--color-primary)] focus:outline-none"
        id={id}
        onChange={(e) =>
          setStack({ [field.name]: e.target.value } as Partial<DraftStack>)
        }
        value={String(value ?? "")}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }
  // text — also used for free-text "org" since the web has no orgs.toml.
  return (
    <input
      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1.5 font-mono text-sm focus:border-[var(--color-primary)] focus:outline-none"
      id={id}
      onChange={(e) =>
        setStack({ [field.name]: e.target.value } as Partial<DraftStack>)
      }
      placeholder={hintFor(field.name)}
      type="text"
      value={String(value ?? "")}
    />
  );
}

function SecretNotice() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] border-dashed bg-[var(--color-muted)] px-2.5 py-2 text-[var(--color-muted-foreground)] text-xs">
      <Lock aria-hidden className="size-3.5" />
      <span>You'll be prompted at the CLI when you run the command.</span>
    </div>
  );
}

function DescriptionTooltip({ description }: { description: string }) {
  return (
    <span
      className="cursor-help text-[var(--color-muted-foreground)]"
      title={description}
    >
      <Info aria-hidden className="size-3.5" />
    </span>
  );
}

function hintFor(name: string): string | undefined {
  if (name === "projectName") {
    return "my-app";
  }
  if (name === "org") {
    return "your-org-slug";
  }
  if (name === "domain") {
    return "my-app.example.com";
  }
  return;
}
