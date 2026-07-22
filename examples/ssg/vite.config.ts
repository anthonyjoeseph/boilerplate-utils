import react from "@vitejs/plugin-react";
import { pathCodec } from "@boilerplate-utils/shared";
import { viteBuildInput, vitePagesPlugin } from "@boilerplate-utils/server/vite";
import { defineConfig } from "vite";

// Route keys are listed here rather than derived from `import * as R from
// "./routes/index.js"` on purpose: vite's config loader bundles vite.config.ts
// and everything it statically imports into a single esbuild-processed file,
// which both inlines `import()` expressions and erases real file paths for
// anything pulled in that way. `page.tsx` calls `staticPage()` at module scope,
// which depends on both of those staying intact — so route modules must only
// ever be loaded live, via `vitePagesPlugin`'s `server.ssrLoadModule`, never
// imported here.
const { parse } = pathCodec("page");

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === "serve"
      ? [vitePagesPlugin({ routesEntry: "./routes/index.ts", parse, dependencies: {} })]
      : [])
  ],
  ...(command === "build" ? viteBuildInput({}) : {})
}));
