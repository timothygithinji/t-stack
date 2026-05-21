import type { z } from "zod";
import { type FieldMeta, fieldMeta } from "./meta.js";

export type Decisions = Record<string, unknown>;

export interface ValueAvailability {
  value: string;
  enabled: boolean;
  reason?: string;
}

/** True when every key in `predicate` matches the corresponding `values` entry. */
function matchesVisibleIf(
  predicate: Record<string, unknown>,
  values: Decisions
): boolean {
  return Object.entries(predicate).every(([k, v]) => values[k] === v);
}

/**
 * Is the whole field visible given the current decisions? Honours `visibleIf`
 * with the same shallow-equality semantics as the CLI prompt loop.
 */
export function isFieldVisible(meta: FieldMeta, decisions: Decisions): boolean {
  if (!meta.visibleIf) {
    return true;
  }
  return matchesVisibleIf(meta.visibleIf, decisions);
}

/**
 * For each enum value of a field, decide whether it's currently selectable
 * given prior decisions. A dependency is "unmet" only if the dependent field
 * has a non-undefined value not in the allowed list — undecided fields don't
 * pre-disable anything.
 */
export function evaluateField(
  meta: FieldMeta,
  enumValues: readonly string[],
  decisions: Decisions
): ValueAvailability[] {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-value walk over dependencies/incompatibilities is intentionally linear.
  return enumValues.map((value) => {
    const rule = meta.valueRules?.[value];
    if (!rule) {
      return { value, enabled: true };
    }
    if (rule.dependencies) {
      for (const [dep, allowed] of Object.entries(rule.dependencies)) {
        const current = decisions[dep];
        if (current === undefined) {
          continue;
        }
        if (!allowed.includes(current as string)) {
          return { value, enabled: false, reason: rule.reason };
        }
      }
    }
    if (rule.incompatibilities) {
      for (const [other, forbidden] of Object.entries(rule.incompatibilities)) {
        const current = decisions[other];
        if (current === undefined) {
          continue;
        }
        if (forbidden.includes(current as string)) {
          return { value, enabled: false, reason: rule.reason };
        }
      }
    }
    return { value, enabled: true };
  });
}

/**
 * Validate a fully-populated decisions object against every field's
 * `valueRules`. Returns one entry per violation (empty array means the
 * combination is internally consistent).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: cross-field validation requires nested walks over fields × values × rule kinds.
export function validateDecisions(
  schema: z.ZodObject<z.ZodRawShape>,
  decisions: Decisions
): Array<{ field: string; value: unknown; conflict: string }> {
  const violations: Array<{
    field: string;
    value: unknown;
    conflict: string;
  }> = [];
  for (const [name, child] of Object.entries(schema.shape)) {
    const meta = fieldMeta.get(child as z.ZodTypeAny);
    if (!meta?.valueRules) {
      continue;
    }
    const current = decisions[name];
    if (current === undefined) {
      continue;
    }
    const values = Array.isArray(current) ? current : [current];
    for (const v of values) {
      if (typeof v !== "string") {
        continue;
      }
      const rule = meta.valueRules[v];
      if (!rule) {
        continue;
      }
      if (rule.dependencies) {
        for (const [dep, allowed] of Object.entries(rule.dependencies)) {
          const depValue = decisions[dep];
          if (depValue === undefined) {
            continue;
          }
          if (!allowed.includes(depValue as string)) {
            violations.push({
              field: name,
              value: v,
              conflict:
                rule.reason ??
                `${name}=${v} requires ${dep} ∈ {${allowed.join(", ")}}`,
            });
          }
        }
      }
      if (rule.incompatibilities) {
        for (const [other, forbidden] of Object.entries(
          rule.incompatibilities
        )) {
          const otherValue = decisions[other];
          if (otherValue === undefined) {
            continue;
          }
          if (forbidden.includes(otherValue as string)) {
            violations.push({
              field: name,
              value: v,
              conflict:
                rule.reason ??
                `${name}=${v} conflicts with ${other}=${String(otherValue)}`,
            });
          }
        }
      }
    }
  }
  return violations;
}
