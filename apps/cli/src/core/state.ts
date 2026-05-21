import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "pathe";
import lockfile from "proper-lockfile";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface StepRecord {
  status: StepStatus;
  at: string;
  refs?: Record<string, unknown>;
  error?: { message: string; stack?: string };
}

export interface StateProject {
  name: string;
  presetId: string;
  org: string;
  createdAt: string;
}

export interface State {
  version: 1;
  project: StateProject;
  steps: Record<string, StepRecord>;
}

export interface StateStore {
  read(): Promise<State>;
  get(stepId: string): StepRecord | undefined;
  set(stepId: string, record: StepRecord): Promise<void>;
  markRunning(stepId: string): Promise<void>;
  markCompleted(stepId: string, refs?: Record<string, unknown>): Promise<void>;
  markFailed(stepId: string, error: unknown): Promise<void>;
  /**
   * Delete a step record entirely. Used by the verify-on-skip flow when the
   * user picks "remove from state" or "recreate" — the step then runs fresh
   * on its next invocation instead of short-circuiting via stale refs.
   */
  remove(stepId: string): Promise<void>;
}

const LOCK_OPTIONS = { retries: { retries: 5, factor: 2 } } as const;

function emptyState(): State {
  return {
    version: 1,
    project: {
      name: "",
      presetId: "",
      org: "",
      createdAt: new Date().toISOString(),
    },
    steps: {},
  };
}

async function ensureFile(stateFile: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  try {
    await readFile(stateFile, "utf8");
  } catch {
    await writeFile(
      stateFile,
      `${JSON.stringify(emptyState(), null, 2)}\n`,
      "utf8"
    );
  }
}

async function loadState(stateFile: string): Promise<State> {
  await ensureFile(stateFile);
  const raw = await readFile(stateFile, "utf8");
  return JSON.parse(raw) as State;
}

async function saveState(stateFile: string, state: State): Promise<void> {
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function toErrorRecord(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export function createStateStore(stateFile: string): StateStore {
  let cache: State | undefined;

  async function withLock<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    await ensureFile(stateFile);
    const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
    try {
      const state = await loadState(stateFile);
      const result = await fn(state);
      await saveState(stateFile, state);
      cache = state;
      return result;
    } finally {
      await release();
    }
  }

  return {
    async read() {
      const state = await loadState(stateFile);
      cache = state;
      return state;
    },
    get(stepId) {
      return cache?.steps[stepId];
    },
    async set(stepId, record) {
      await withLock((state) => {
        state.steps[stepId] = record;
      });
    },
    async markRunning(stepId) {
      await withLock((state) => {
        state.steps[stepId] = {
          status: "running",
          at: new Date().toISOString(),
        };
      });
    },
    async markCompleted(stepId, refs) {
      await withLock((state) => {
        state.steps[stepId] = {
          status: "completed",
          at: new Date().toISOString(),
          ...(refs ? { refs } : {}),
        };
      });
    },
    async markFailed(stepId, error) {
      await withLock((state) => {
        state.steps[stepId] = {
          status: "failed",
          at: new Date().toISOString(),
          error: toErrorRecord(error),
        };
      });
    },
    async remove(stepId) {
      await withLock((state) => {
        delete state.steps[stepId];
      });
    },
  };
}
