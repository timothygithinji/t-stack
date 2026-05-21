import { copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type CommentJSONValue, parse as parseJsonc } from "comment-json";
import { dirname, join } from "pathe";
import { describe, expect, it } from "vitest";
import { patchWrangler } from "../../src/plugins/cloudflare.js";
import { makeTempDir, makeTestCtx } from "../_helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  __dirname,
  "..",
  "fixtures",
  "wrangler-with-comments.jsonc"
);

interface WranglerShape {
  name?: string;
  main?: string;
  compatibility_date?: string;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  vars?: Record<string, string>;
}

describe("patchWrangler", () => {
  it("updates only kv_namespaces and r2_buckets and preserves comments", async () => {
    const cwd = await makeTempDir("cf-patch-");
    await copyFile(FIXTURE, join(cwd, "wrangler.jsonc"));

    const ctx = await makeTestCtx({ cwd });
    await patchWrangler(ctx, {
      kvNamespaceId: "kv-id-123",
      kvNamespaceTitle: "demo-kv",
      r2BucketName: "demo-bucket",
      workerUrl: "https://demo.workers.dev",
    });

    const raw = await readFile(join(cwd, "wrangler.jsonc"), "utf8");

    // Comments are preserved.
    expect(raw).toContain("// managed by Pulumi");
    expect(raw).toContain("// worker entry");
    expect(raw).toContain("// do not edit by hand");

    // Re-parse and verify the structural changes.
    const parsed = parseJsonc(raw, undefined, false) as CommentJSONValue;
    const obj = parsed as unknown as WranglerShape;
    expect(obj.kv_namespaces).toEqual([{ binding: "KV", id: "kv-id-123" }]);
    expect(obj.r2_buckets).toEqual([
      { binding: "BUCKET", bucket_name: "demo-bucket" },
    ]);
    // Other fields survive untouched.
    expect(obj.name).toBe("demo-worker");
    expect(obj.main).toBe("src/index.ts");
    expect(obj.compatibility_date).toBe("2024-09-23");
    expect(obj.vars).toEqual({ ENV: "production", FEATURE_FLAG: "on" });
  });
});
