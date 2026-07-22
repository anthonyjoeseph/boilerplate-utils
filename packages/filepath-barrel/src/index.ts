#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";

function findFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
      entry.name !== "index.ts" &&
      entry.name !== "index.js"
    ) {
      results.push(full);
    }
  }
  return results;
}

function toIdentifier(relWithExt: string): string {
  return relWithExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function parseArgs(argv: string[]): {
  dir: string | undefined;
  barrelFile: string | undefined;
  arrayFile: string | undefined;
} {
  let dir: string | undefined;
  let barrelFile: string | undefined;
  let arrayFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "-d" || arg === "--directory") && argv[i + 1]) {
      dir = argv[++i];
    } else if ((arg === "-b" || arg === "--barrel-file") && argv[i + 1]) {
      barrelFile = argv[++i];
    } else if ((arg === "-a" || arg === "--array-file") && argv[i + 1]) {
      arrayFile = argv[++i];
    }
  }

  return { dir, barrelFile, arrayFile };
}

function main() {
  const { dir, barrelFile, arrayFile } = parseArgs(process.argv.slice(2));

  if (!dir || !barrelFile) {
    console.error(
      "Usage: filepath-barrel -d <directory> -b <barrel-file.ts> [-a <array-file.ts>]"
    );
    process.exit(1);
  }

  const absDir = path.resolve(dir);

  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }

  const files = findFiles(absDir);
  const routes = files.map((f) => {
    const relWithExt = path.relative(absDir, f);
    const rel = relWithExt.replace(/\.(ts|tsx|js|jsx)$/, "");
    const key = rel.split(path.sep).join("/");
    const id = toIdentifier(relWithExt.split(path.sep).join("/"));
    return { key, rel: "./" + key, id };
  });

  // Barrel file: import * as id from "rel"; export { id as "key", ... }
  const absBarrel = path.resolve(barrelFile);
  fs.mkdirSync(path.dirname(absBarrel), { recursive: true });
  const imports = routes
    .map(({ rel, id }) => `import * as ${id} from "${rel}";`)
    .join("\n");
  const exportList = routes
    .map(({ key, id }) => `${id} as "${key}"`)
    .join(", ");
  fs.writeFileSync(absBarrel, `${imports}\n\nexport { ${exportList} };\n`);
  console.log(`Written: ${absBarrel}`);

  // Array file (optional): export default ["./rel", ...] as const
  if (arrayFile) {
    const absArray = path.resolve(arrayFile);
    fs.mkdirSync(path.dirname(absArray), { recursive: true });
    const items = routes.map(({ rel }) => `  "${rel}"`).join(",\n");
    fs.writeFileSync(absArray, `export default [\n${items},\n] as const;\n`);
    console.log(`Written: ${absArray}`);
  }
}

main();
