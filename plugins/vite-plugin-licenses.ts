/**
 * Vite plugin that collects license information from npm and Cargo
 * dependencies at build time.
 *
 * - The virtual module "virtual:licenses" contains the summary list
 *   (name, license identifier, url) — small, bundled inline.
 * - A separate static asset "license-texts.json" contains the full license
 *   texts keyed by package name — loaded on demand at runtime.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:licenses";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

interface LicenseSummary {
  name: string;
  license: string;
  url?: string;
}

function getRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Read all LICENSE/LICENCE/COPYING files from a directory, concatenated. */
function readLicenseFiles(dir: string): string {
  if (!existsSync(dir)) return "";
  try {
    const files = readdirSync(dir).filter((f) =>
      /^(LICENSE|LICENCE|COPYING|NOTICE)([._-].*)?$/i.test(f),
    );
    if (files.length === 0) return "";
    return files
      .sort()
      .map((f) => {
        const content = readFileSync(join(dir, f), "utf-8").trim();
        return files.length > 1 ? `--- ${f} ---\n${content}` : content;
      })
      .join("\n\n");
  } catch {
    return "";
  }
}

/** Collect licenses from production npm dependencies listed in package.json. */
function collectNpmLicenses(root: string): {
  summaries: LicenseSummary[];
  texts: Record<string, string>;
} {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const prodDeps = Object.keys(pkg.dependencies ?? {});

  const summaries: LicenseSummary[] = [];
  const texts: Record<string, string> = {};

  for (const dep of prodDeps) {
    const depDir = join(root, "node_modules", dep);
    const depPkgPath = join(depDir, "package.json");
    if (!existsSync(depPkgPath)) continue;
    try {
      const depPkg = JSON.parse(readFileSync(depPkgPath, "utf-8"));
      const name = depPkg.name ?? dep;
      const repoUrl =
        typeof depPkg.repository === "string"
          ? depPkg.repository
          : depPkg.repository?.url
              ?.replace(/^git\+/, "")
              .replace(/\.git$/, "");
      summaries.push({
        name,
        license: depPkg.license ?? "Unknown",
        url: repoUrl,
      });
      const text = readLicenseFiles(depDir);
      if (text) texts[name] = text;
    } catch {
      summaries.push({ name: dep, license: "Unknown" });
    }
  }

  return { summaries, texts };
}

/** Find the cargo registry source cache directory. */
function findCargoRegistryCache(): string | null {
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  const srcDir = join(cargoHome, "registry", "src");
  if (!existsSync(srcDir)) return null;
  try {
    const indices = readdirSync(srcDir);
    const idx = indices.find((d) => d.startsWith("index.crates.io"));
    return idx ? join(srcDir, idx) : null;
  } catch {
    return null;
  }
}

/** Collect licenses from all Cargo dependencies using cargo metadata + registry cache. */
function collectCargoLicenses(root: string): {
  summaries: LicenseSummary[];
  texts: Record<string, string>;
} {
  const tauriDir = join(root, "src-tauri");
  if (!existsSync(join(tauriDir, "Cargo.toml")))
    return { summaries: [], texts: {} };

  try {
    const rawFull = execSync(
      "cargo metadata --format-version 1 2>/dev/null || true",
      {
        cwd: tauriDir,
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (!rawFull.trim()) return { summaries: [], texts: {} };

    const metadata = JSON.parse(rawFull);
    const workspaceMembers = new Set<string>(metadata.workspace_members ?? []);
    const registryCache = findCargoRegistryCache();

    const summaries: LicenseSummary[] = [];
    const texts: Record<string, string> = {};
    const seen = new Set<string>();

    for (const pkg of metadata.packages ?? []) {
      if (workspaceMembers.has(pkg.id)) continue;
      if (seen.has(pkg.name)) continue;
      seen.add(pkg.name);

      summaries.push({
        name: pkg.name,
        license: pkg.license ?? "Unknown",
        url: pkg.repository ?? undefined,
      });

      if (registryCache) {
        const crateDir = join(registryCache, `${pkg.name}-${pkg.version}`);
        const text = readLicenseFiles(crateDir);
        if (text) texts[pkg.name] = text;
      }
    }

    return { summaries, texts };
  } catch {
    return { summaries: [], texts: {} };
  }
}

export default function licensesPlugin(): Plugin {
  let cachedModule: string;
  let textsJson: string;

  return {
    name: "vite-plugin-licenses",

    buildStart() {
      const root = getRoot();
      const npm = collectNpmLicenses(root);
      const cargo = collectCargoLicenses(root);

      // Merge summaries, deduplicate by name, sort alphabetically
      const merged = new Map<string, LicenseSummary>();
      for (const e of [...npm.summaries, ...cargo.summaries]) {
        if (!merged.has(e.name)) merged.set(e.name, e);
      }
      const summaries = Array.from(merged.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      // Merge texts
      const allTexts: Record<string, string> = {
        ...npm.texts,
        ...cargo.texts,
      };

      cachedModule = `export default ${JSON.stringify(summaries)};`;
      textsJson = JSON.stringify(allTexts);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id === RESOLVED_ID) return cachedModule;
    },

    // In dev mode, serve the texts JSON via a middleware endpoint.
    configureServer(server) {
      server.middlewares.use("/license-texts.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(textsJson);
      });
    },

    // In production, emit the texts as a static asset.
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "license-texts.json",
        source: textsJson,
      });
    },
  };
}
