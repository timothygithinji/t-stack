import { log as clackLog, spinner as clackSpinner } from "@clack/prompts";
import { consola } from "consola";

export interface Spinner {
  start: (msg: string) => void;
  stop: (msg: string) => void;
}

export interface Logger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  step: (msg: string) => void;
  debug: (msg: string) => void;
  spinner: () => Spinner;
}

const DEBUG = process.env.T_STACK_DEBUG === "1";

/**
 * Spinner factory that degrades gracefully in non-TTY contexts.
 *
 * In a TTY: returns the Clack rotating-frame spinner.
 * In a pipe/log/CI: prints the stop message verbatim — callers are
 * expected to embed their own status glyph (✓ / ✗) so we mirror clack's
 * TTY behaviour where the caller's text follows the spinner frame. The
 * start call is a no-op so we don't double the line count by repeating
 * the same text.
 */
export function createSpinner(): Spinner {
  if (process.stdout.isTTY) {
    const s = clackSpinner();
    return {
      start: (msg) => s.start(msg),
      stop: (msg) => s.stop(msg),
    };
  }
  return {
    start: () => {
      // no-op: stop prints the final state
    },
    stop: (msg) => {
      process.stderr.write(`${msg}\n`);
    },
  };
}

export function createLogger(): Logger {
  return {
    info: (msg) => clackLog.info(msg),
    success: (msg) => clackLog.success(msg),
    warn: (msg) => clackLog.warn(msg),
    error: (msg, err) => {
      clackLog.error(msg);
      if (err && DEBUG) {
        consola.error(err);
      }
    },
    step: (msg) => clackLog.step(msg),
    debug: (msg) => {
      if (DEBUG) {
        consola.debug(`[t-stack] ${msg}`);
      }
    },
    spinner: () => createSpinner(),
  };
}

/** A no-op logger for tests / non-TTY contexts. */
export function createSilentLogger(): Logger {
  const noop = () => {
    // intentionally empty
  };
  return {
    info: noop,
    success: noop,
    warn: noop,
    error: noop,
    step: noop,
    debug: noop,
    spinner: () => ({ start: noop, stop: noop }),
  };
}
