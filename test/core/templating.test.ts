import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "pathe";
import { describe, expect, it } from "vitest";
import { renderString, renderTemplate } from "../../src/core/templating.js";
import { makeTempDir } from "../_helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

describe("renderString", () => {
  it("interpolates {{name}}", () => {
    expect(renderString("hi {{name}}", { name: "world" })).toBe("hi world");
  });

  it("{{{json envs}}} produces JSON encoded value with quoted string", () => {
    const out = renderString("ENVS={{{json envs}}}", { envs: "dev+prd" });
    // Helper produces JSON.stringify("dev+prd") => "dev+prd" with literal double-quotes.
    expect(out).toBe('ENVS="dev+prd"');
  });

  it("conditional helper renders only when truthy", () => {
    const tmpl = "{{#if hookdeck}}YES{{/if}}";
    expect(renderString(tmpl, { hookdeck: true })).toBe("YES");
    expect(renderString(tmpl, { hookdeck: false })).toBe("");
  });
});

describe("renderTemplate", () => {
  it("renders templated filenames and content", async () => {
    const dest = await makeTempDir("tpl-simple-");
    const result = await renderTemplate(
      join(FIXTURES, "templating-simple"),
      dest,
      { name: "scout" }
    );
    expect(result.filesWritten).toBe(1);
    const content = await readFile(join(dest, "scout.txt"), "utf8");
    expect(content).toBe("hi scout\n");
  });

  it("copies binary files byte-for-byte (PNG)", async () => {
    const dest = await makeTempDir("tpl-binary-");
    const srcDir = join(FIXTURES, "templating-binary");
    const result = await renderTemplate(srcDir, dest, {});
    expect(result.filesWritten).toBe(1);

    const original = await readFile(join(srcDir, "logo.png"));
    const copied = await readFile(join(dest, "logo.png"));
    expect(copied.equals(original)).toBe(true);
    // sanity: PNG magic should be intact
    expect(copied[0]).toBe(0x89);
    expect(copied[1]).toBe(0x50);
    expect(copied[2]).toBe(0x4e);
    expect(copied[3]).toBe(0x47);
  });

  it("skips files whose path segment renders to empty (conditional filename)", async () => {
    // renderRelativePath splits on `/` and renders each segment independently —
    // so a segment that renders to "" causes the file to be skipped entirely
    // (its conditional path collapses). We exercise this with a `{{conditional}}`
    // var rather than an `{{#if}}` block because the block's closing tag
    // contains a `/`, which on-disk filenames cannot.
    const srcDir = await makeTempDir("tpl-cond-src-");
    await writeFile(
      join(srcDir, "{{conditional}}hookdeck.config.ts"),
      "export default {};\n",
      "utf8"
    );
    await writeFile(join(srcDir, "always.txt"), "always", "utf8");

    // OFF: passing an empty-string variable can't collapse the *whole* segment,
    // so instead we model "off" by rendering against a dir whose entire segment
    // is the variable.
    const condSubdir = join(srcDir, "{{maybe}}");
    await mkdir(condSubdir, { recursive: true });
    await writeFile(
      join(condSubdir, "hookdeck.config.ts"),
      "export default {};\n",
      "utf8"
    );

    const destOff = await makeTempDir("tpl-cond-off-");
    const offResult = await renderTemplate(srcDir, destOff, {
      conditional: "",
      maybe: "",
    });
    // The {{maybe}}/hookdeck.config.ts path collapses to "" and is skipped.
    // The {{conditional}}hookdeck.config.ts file gets written as "hookdeck.config.ts"
    // since only the prefix evaluates to empty — the segment itself is non-empty.
    expect(offResult.filesWritten).toBe(2);
    await expect(readFile(join(destOff, "always.txt"), "utf8")).resolves.toBe(
      "always"
    );
    await expect(
      readFile(join(destOff, "hookdeck.config.ts"), "utf8")
    ).resolves.toContain("export default");

    const destOn = await makeTempDir("tpl-cond-on-");
    const onResult = await renderTemplate(srcDir, destOn, {
      conditional: "x-",
      maybe: "hooks",
    });
    // {{maybe}} → "hooks" so the conditional file is written under hooks/.
    expect(onResult.filesWritten).toBe(3);
    await expect(
      readFile(join(destOn, "x-hookdeck.config.ts"), "utf8")
    ).resolves.toContain("export default");
    await expect(
      readFile(join(destOn, "hooks", "hookdeck.config.ts"), "utf8")
    ).resolves.toContain("export default");
  });
});
