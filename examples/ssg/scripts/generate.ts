import { generatePages } from "@boilerplate-utils/server";
import * as R from "../routes/index.js";

const { files } = await generatePages({ routes: R, dependencies: {} });

for (const [routeKey, file] of Object.entries(files)) {
  console.log(`generated ${routeKey} -> ${file}`);
}
