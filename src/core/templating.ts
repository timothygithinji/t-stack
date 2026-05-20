import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import Handlebars from "handlebars";
import { dirname, extname, join, relative } from "pathe";

Handlebars.registerHelper("json", (value: unknown) => JSON.stringify(value));
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
]);

async function isBinary(filePath: string): Promise<boolean> {
  if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return true;
  }
  const fh = await readFile(filePath);
  const sample = fh.subarray(0, Math.min(8192, fh.length));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

export function renderString(
  template: string,
  vars: Record<string, unknown>
): string {
  return Handlebars.compile(template, { noEscape: true })(vars);
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      out.push(full);
    }
  }
  return out;
}

function renderRelativePath(
  rel: string,
  vars: Record<string, unknown>
): string {
  const rendered = renderString(rel, vars).trim();
  if (!rendered) {
    return "";
  }
  if (rendered.endsWith("/") || rendered.startsWith("/")) {
    return "";
  }
  if (rendered.includes("//")) {
    return "";
  }
  return rendered;
}

export async function renderTemplate(
  srcDir: string,
  destDir: string,
  vars: Record<string, unknown>
): Promise<{ filesWritten: number }> {
  const srcStat = await stat(srcDir);
  if (!srcStat.isDirectory()) {
    throw new Error(`Template source is not a directory: ${srcDir}`);
  }

  const files = await walk(srcDir);
  let filesWritten = 0;

  for (const file of files) {
    const rel = relative(srcDir, file);
    const renderedRel = renderRelativePath(rel, vars);
    if (!renderedRel) {
      continue;
    }

    const destPath = join(destDir, renderedRel);
    await mkdir(dirname(destPath), { recursive: true });

    if (await isBinary(file)) {
      await copyFile(file, destPath);
    } else {
      const raw = await readFile(file, "utf8");
      const rendered = renderString(raw, vars);
      await writeFile(destPath, rendered, "utf8");
    }
    filesWritten += 1;
  }

  return { filesWritten };
}
