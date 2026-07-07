import { renderToString } from "react-dom/server";
import fs from "fs/promises";
import { App } from "../apps/PlainApp";

const newHtml = `
<html>
    <div id="app">${renderToString(App)}</div>
    <script type="module" src="index.ts"></script>
</html>
`;
const existingHtml = await fs
  .readFile("./src/examples/react/static-render/index.html", { encoding: "utf-8" })
  .catch(() => "");
if (existingHtml !== newHtml) {
  console.log("writing file");
  await fs.writeFile("./src/examples/react/static-render/index.html", newHtml);
} else {
  console.log("no changes");
}
