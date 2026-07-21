import fs from "node:fs/promises";
import { renderToString } from "react-dom/server";
import { App } from "./App";

const template = await fs.readFile("./index.html", { encoding: "utf-8" });
const appHtml = renderToString(App());
const newHtml = template.replace("<!--ssg-outlet-->", appHtml);

const outDir = "./dist-ssg";
const outFile = `${outDir}/index.html`;

const existingHtml = await fs.readFile(outFile, { encoding: "utf-8" }).catch(() => "");
if (existingHtml !== newHtml) {
  console.log("writing file");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, newHtml);
} else {
  console.log("no changes");
}
