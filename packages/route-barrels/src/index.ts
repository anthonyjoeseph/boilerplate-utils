#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";

function findRouteFiles(dir: string, base: string = dir): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(full, base));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name) && entry.name !== "index.ts" && entry.name !== "index.js") {
      results.push(full);
    }
  }
  return results;
}

function toIdentifier(file: string): string {
  // include extension chars so identifiers are unique; strip non-alphanumeric and lowercase
  return file.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function main() {
  const args = process.argv.slice(2);
  const dFlag = args.indexOf("-d");
  if (dFlag === -1 || !args[dFlag + 1]) {
    console.error("Usage: route-barrels -d <directory>");
    process.exit(1);
  }

  const dir = path.resolve(args[dFlag + 1]);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = findRouteFiles(dir);
  const routes = files.map((f) => {
    const relWithExt = path.relative(dir, f);
    const rel = relWithExt.replace(/\.(ts|tsx|js|jsx)$/, "");
    // normalize to forward slashes
    const key = rel.split(path.sep).join("/");
    const id = toIdentifier(relWithExt.split(path.sep).join("/"));
    return { key, rel: "./" + key, id };
  });

  const imports = routes.map(({ rel, id }) => `import * as ${id} from "${rel}";`).join("\n");
  const exportList = routes.map(({ key, id }) => `${id} as "${key}"`).join(", ");

  const output = `${imports}\n\nexport { ${exportList} };\n`;

  const outPath = path.join(dir, "index.ts");
  fs.writeFileSync(outPath, output);
  console.log(`Written: ${outPath}`);
}

main();
