#!/usr/bin/env node
// @orchestration-ai/create-installer
//
// Scaffolds an Orchestration AI installer into a new directory or an existing
// project (e.g. shared-services). Dependency-free: Node builtins only.
//
// Usage:
//   npx @orchestration-ai/create-installer <name>
//   npx @orchestration-ai/create-installer --into shared-services --name sales-copilot [--wire] [--custom-step]

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, "..", "templates");

// SDK version pinned into generated standalone package.json. Bump on release.
const DEFAULT_SDK_VERSION = "0.31.0";

// --- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wire") args.flags.wire = true;
    else if (a === "--custom-step") args.flags.customStep = true;
    else if (a === "--into") args.flags.into = argv[++i];
    else if (a === "--name") args.flags.name = argv[++i];
    else if (a.startsWith("--")) args.flags[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleize(slug) {
  return slug.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// --- template rendering ----------------------------------------------------

async function renderTemplate(name, vars) {
  const raw = await readFile(join(TEMPLATES, name), "utf8");
  return raw.replace(/{{(\w+)}}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}

async function writeOut(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  console.log(`  created ${path}`);
}

// --- project detection -----------------------------------------------------

async function detectRuntime(targetRoot) {
  // A project with deno.json is Deno; otherwise assume Node.
  if (existsSync(join(targetRoot, "deno.json")) || existsSync(join(targetRoot, "deno.jsonc"))) {
    return "deno";
  }
  return "node";
}

// --- wiring (--wire) -------------------------------------------------------

async function wireAppTs(targetRoot, slug, runtime) {
  const appPath = join(targetRoot, "app.ts");
  if (!existsSync(appPath)) {
    console.log(`  (skip --wire: no app.ts found in ${targetRoot})`);
    return;
  }
  const varName = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Installer";
  const importExt = runtime === "deno" ? ".ts" : "";
  const importLine = `import { ${varName} } from "./${slug}/${slug}.installer${importExt}";`;
  const mountComment =
    `\n// Mount the "${slug}" installer. It serves its own landing page + wizard.\n` +
    `// app.use("/${slug}", ${varName}.expressApp);\n`;

  let src = await readFile(appPath, "utf8");
  if (src.includes(importLine)) {
    console.log("  (already wired)");
    return;
  }
  // Insert the import after the last import line.
  const lines = src.split("\n");
  let lastImport = 0;
  lines.forEach((l, i) => { if (/^\s*import\b/.test(l)) lastImport = i; });
  lines.splice(lastImport + 1, 0, importLine);
  src = lines.join("\n") + mountComment;
  await writeFile(appPath, src, "utf8");
  console.log(`  wired import into ${appPath} (mount line added as a comment — uncomment to enable)`);
}

// --- main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let name = args.flags.name || args._[0];
  let into = args.flags.into;
  let wire = Boolean(args.flags.wire);
  let withCustomStep = Boolean(args.flags.customStep);

  const interactive = !name || process.stdout.isTTY;
  let rl;
  if (!name) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    name = await rl.question("Installer name (e.g. Sales Copilot): ");
  }

  const slug = slugify(name);
  if (!slug) {
    console.error("A non-empty installer name is required.");
    process.exit(1);
  }
  const title = titleize(slug);

  // Resolve the output directory.
  const cwd = process.cwd();
  const targetRoot = into ? resolve(cwd, into) : resolve(cwd, slug);
  const runtime = await detectRuntime(into ? targetRoot : cwd);
  const outDir = into ? join(targetRoot, slug) : targetRoot;

  if (rl && !args.flags.customStep) {
    const ans = (await rl.question("Include a custom third-party setup step example? (y/N): ")).trim().toLowerCase();
    withCustomStep = ans === "y" || ans === "yes";
  }
  rl?.close();

  console.log(`\nScaffolding "${title}" (${runtime}) into ${outDir}\n`);

  const vars = {
    name: title,
    slug,
    varName: slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Installer",
    importExt: runtime === "deno" ? ".ts" : "",
    sdkVersion: DEFAULT_SDK_VERSION,
    customStepBlock: "",
    customStepImport: "",
  };

  if (withCustomStep) {
    vars.customStepImport = `\nimport { connectExampleStep } from "./custom-steps/connect-example${vars.importExt}";`;
    vars.customStepBlock = `\n  customSteps: [connectExampleStep],`;
  }

  // Definition + entrypoint.
  await writeOut(join(outDir, `${slug}.installer.ts`), await renderTemplate("installer.ts.tmpl", vars));
  await writeOut(join(outDir, "install.ts"), await renderTemplate("install.ts.tmpl", vars));
  await writeOut(join(outDir, "README.md"), await renderTemplate("README.md.tmpl", vars));

  // Standalone project files. Only for a NEW Node project — when scaffolding
  // `--into` an existing project it already has its own, and Deno projects use
  // deno.json rather than package.json/tsconfig.json.
  const standalone = !into && runtime === "node";
  if (standalone) {
    await writeOut(join(outDir, "package.json"), await renderTemplate("package.json.tmpl", vars));
    await writeOut(join(outDir, "tsconfig.json"), await renderTemplate("tsconfig.json.tmpl", vars));
  }

  if (withCustomStep) {
    await writeOut(join(outDir, "custom-steps", "connect-example.ts"), await renderTemplate("custom-step.ts.tmpl", vars));
    await writeOut(join(outDir, "custom-steps", "connect-example.html"), await renderTemplate("custom-step.html.tmpl", vars));
  }

  if (wire) {
    await wireAppTs(targetRoot, slug, runtime);
  }

  console.log(`\nDone. Next steps:`);
  if (runtime === "deno") {
    console.log(`  cd ${into || slug}`);
    console.log(`  deno run --allow-all --env-file ${into ? `${slug}/install.ts` : "install.ts"}`);
  } else if (standalone) {
    console.log(`  cd ${slug}`);
    console.log(`  npm install`);
    console.log(`  npm start`);
  } else {
    console.log(`  cd ${into ? join(into, slug) : slug}`);
    console.log(`  npm install @orchestration-ai/sdk`);
    console.log(`  npx tsx install.ts`);
  }
  console.log(`\nSet INSTALLER_OAUTH_CLIENT_ID / INSTALLER_OAUTH_CLIENT_SECRET / INSTALLER_OAUTH_REDIRECT_URI before running.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
