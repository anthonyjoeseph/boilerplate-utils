import react from "@vitejs/plugin-react";
import { pathCodec } from "@boilerplate-utils/shared";
import {
  viteBuildInput,
  vitePagesPlugin
} from "@boilerplate-utils/server/vite";
import { defineConfig } from "vite";

// Route keys must be listed manually — NOT via `import * as R` — because
// vite's config loader bundles vite.config.ts and everything it statically
// imports, which inlines dynamic imports and loses real file paths. Route
// modules call staticPage/dynamicPage at module scope; those functions read
// their own source off disk via a stack trace — that only works when the
// module was loaded live, not pre-bundled into the config.
const { parse } = pathCodec("home", "ticker", "user/[userId]");

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    ...(command === "serve"
      ? [
          vitePagesPlugin({
            routesEntry: "./routes/index.ts",
            parse,
            dependencies: {}
          })
        ]
      : [])
  ],
  ...(command === "build" ? viteBuildInput({}) : {})
}));
