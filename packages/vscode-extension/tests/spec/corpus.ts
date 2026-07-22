/**
 * Loads the spec corpus from disk.
 *
 * Each subdirectory of `cases/` is one spec: every `.ts`/`.tsx` file in it
 * becomes part of the fixture program, and an optional `spec.json` configures
 * the expectation. Adding a spec means adding a directory - no registration.
 */
import * as fs from "fs";
import * as path from "path";

import type { ProgramFiles, SpecCase, SpecConfig } from "./runSpec";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

const readFilesRecursively = (dir: string, prefix = ""): ProgramFiles =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry): [string, string][] => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return Object.entries(
          readFilesRecursively(path.join(dir, entry.name), rel)
        );
      }
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) return [];
      if (entry.name.endsWith(".d.ts")) return [];
      return [[rel, fs.readFileSync(path.join(dir, entry.name), "utf8")]];
    })
    .reduce<Record<string, string>>(
      (acc, [rel, text]) => ({ ...acc, [rel]: text }),
      {}
    );

const readConfig = (dir: string): SpecConfig => {
  const configPath = path.join(dir, "spec.json");
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as SpecConfig;
};

export const loadCorpus = (casesDir: string): readonly SpecCase[] =>
  fs
    .readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(casesDir, entry.name);
      const config = readConfig(dir);
      return {
        name: entry.name,
        dir,
        entry: config.entry ?? "entry.ts",
        config,
        files: readFilesRecursively(dir)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
