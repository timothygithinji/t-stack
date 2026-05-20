/**
 * Sensitive-key redaction for step refs persisted to `state.json`.
 *
 * `state.json` is committed by `github.firstCommit`, so any plaintext
 * credentials inside step refs would end up in git history. The step
 * runner uses {@link redactRefsForState} to scrub sensitive values
 * before persisting; the un-redacted object continues to flow in-memory
 * to downstream steps (e.g. `doppler.seedSecrets`, `trigger.syncEnvVars`).
 *
 * The rule is allowlist-by-pattern (defensive by default): any key whose
 * name contains "secret", "password", "token", "connectionString",
 * "authToken", "apiKey", or "privateKey" (case-insensitive) is replaced
 * with the {@link REDACTED} sentinel. We use a string sentinel (rather
 * than dropping the key) so a future reader of `state.json` can tell the
 * value was intentionally scrubbed.
 */

export const REDACTED = "<redacted>";

const SENSITIVE_KEY_PATTERN =
  /(?:secret|password|token|connectionstring|authtoken|apikey|privatekey)/i;

/**
 * Returns true if a refs key should be considered sensitive and replaced
 * with {@link REDACTED} before being written to `state.json`.
 *
 * Exported for tests; plugins should not need to call this directly.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Returns a deep copy of `refs` with any sensitive values replaced by the
 * {@link REDACTED} sentinel. The input is left unchanged.
 *
 * Recurses into nested plain objects and arrays. Once a key is flagged as
 * sensitive its entire value is replaced — we do not recurse further, so
 * sub-fields of a sensitive object are not separately serialized.
 */
export function redactRefsForState<T extends Record<string, unknown>>(
  refs: T
): T {
  return redactValue(refs) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
