# Boilerplate Utils

## Example Repo Setup

Users can use [github template repositories](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository) to quickly scaffold a new monorepo for their app

Users are encouraged (though not required) to use:

- `zod` for schema validation
- `parceljs` for bundling
- `PGTyped` to auto-generate typescript types for their sql
- `flyway` for sql migrations
- `barrelsby` to auto-generate barrel exports (the `--filesystem` flag is particularly useful for defining nextjs-style routes, see the @boilerplate-utils/server readme for details)

Users are encouraged (though not required) to set up a repo structure with only a single 'shared' package, like this:

my-app/
├─ apps/
│ ├─ web/
│ ├─ socket/
│ ├─ bkgd-workers/
├─ packages/
│ ├─ shared/
├─ package.json

(created with [ascii-tree-generator](https://ascii-tree-generator.com/))

The apps (web, socket, bkgd-workers) are all thin shells that only serve to execute code exported by `shared`.

The engineering reason is - there's no reason to introduce any structural boundaries between shared code. A web bundler will prune unused dependencies on the frontend, and esbuild can quickly do that for backend builds

The practical reason (as far as this repo is concerned) is - it's easy to expand a template function in the `shared` package and immediately have access to it within all of your apps

# Implementation Status & Info

## Roadmap

Items listed are all unfinished. The top item is currently being worked on. It will be deleted from the top of the list once it's done.

1. set up package.jsons & tsconfig.jsons for every package. Packages should be able to depend on each other. Typescript should be noemit, should cache to node_modules, and should not use project references
1. set up eslint and prettier w/ flat config at roots.
1. research vscode-extensions - does it make sense to have a separate package for the lsp and for the vscode-specific plugin? It looks like eslint does it all in one...
1. set up CI w/ vitest smoke tests for all packages (maybe write a custom github action, with package-name as the input?)
1. set up push-to-npm on merge to main for each package (again - maybe a configurable custom action?)
1. research yeoman - is it a good fit for us? Can we store code in this repo that gets pushed to the yeoman repo? Can we do it in GHA? How difficult is it to update?

## Repo Style

- vitest for everything, separate CI workflows per-package, with tests on depended-upon packages being triggered within the same workflow
  - e.g. an update to template-fns triggers only tests for itself, and runs inside of . And update to 'shared' triggers tests for everything

## Code Style

- **Pure functional style.** No side effects outside of function calls.
  - An import statement must never execute code (no top-level `fetch`/DB connections/registration side effects on module load).
  - Dependency-injection all the way — everything a function needs is passed in as a parameter, not reached for via module-level state or singletons.
- **Minimize mutable state**, especially in-memory. Prefer `remeda` and `Array.prototype` methods (`map`/`filter`/`reduce`/etc.) over `for` loops and in-place array/object mutation.
- **Strong types everywhere.**
  - Unstructured data (API responses, env vars, request bodies, DB rows from raw SQL) must be validated before use.
  - Validate at the boundaries of the system — once data has crossed in, it's trusted and typed.
  - "Parse, don't validate" — turn unstructured input into a structured, typed value at the boundary (e.g. `schema.parse(x)`) rather than checking booleans about it deeper in the call stack.
  - Zod-ify everything — every boundary (tRPC input, env, external API response, raw SQL row) gets a Zod schema.
