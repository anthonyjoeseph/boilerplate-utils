import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MethodHandlers } from "./request-handler.js";

export interface StaticAsset {
  content: NodeJS.ArrayBufferView;
  extension: string;
}

export const collectStaticAssets = async <
  Routes extends Record<string, MethodHandlers<any, any>>,
  Dependencies
>(
  routes: Routes,
  dependencies: Dependencies
): Promise<Record<string, StaticAsset>> => {
  const assets: Record<string, StaticAsset> = {};

  for (const [routePath, handlers] of Object.entries(routes)) {
    for (const handler of Object.values(handlers)) {
      if (handler?.type !== "static-request") continue;
      assets[routePath] = {
        content: await handler.fn(dependencies),
        extension: handler.extension
      };
    }
  }

  return assets;
};

export const generateStatic = (assets: Record<string, StaticAsset>): string => {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "boilerplate-utils-static-")
  );

  for (const [routePath, { content, extension }] of Object.entries(assets)) {
    const filePath = path.join(outDir, `${routePath}.${extension}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return outDir;
};
