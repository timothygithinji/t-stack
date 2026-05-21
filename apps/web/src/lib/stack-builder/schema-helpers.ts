import type { z } from "zod";

/**
 * Pull enum choices out of a Zod schema, unwrapping .default() / .optional()
 * wrappers. Mirrors the CLI's `enumChoices` in apps/cli/src/core/schema-runtime
 * but kept local so the web bundle doesn't need to import a CLI-tagged module.
 */
export function enumChoicesForField(
  schema: z.ZodTypeAny
): readonly string[] | undefined {
  let cursor: z.ZodTypeAny = schema;
  for (let i = 0; i < 4; i += 1) {
    const def = cursor._zod?.def;
    if (!def) {
      return;
    }
    if (def.type === "enum") {
      const entries = (def as unknown as { entries: Record<string, string> })
        .entries;
      return Object.values(entries);
    }
    if (def.type === "default" || def.type === "optional") {
      cursor = (def as unknown as { innerType: z.ZodTypeAny }).innerType;
      continue;
    }
    return;
  }
  return;
}
