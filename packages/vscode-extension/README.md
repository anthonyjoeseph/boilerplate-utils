# @boilerplate-utils vscode extension

Using fable. Finish the extension (expanding functions & adding imports, pruning imports that won’t be used, object.map etc, handling all possible cases of return value situations)

--

Now for the extension- let’s add semantic function search & location search. Refer to the Claude conversation for impl details.

This will require a side-panel ui, now, for entering the endpoints for embeddings and qwen, and managing the local SQLite contents

Now let’s add function auto-naming on extraction, and a “place in new sibling file” shortcut that auto-names it, and a “move to file with description” that does the semantic search, and then shuffles around all of the necessary imports

--

Now let’s add “Jerry” (short for “Jerry-rig”)

He’s part of the Ui sidebar and he runs “tasks”. He runs the input through a small “intelligence” engine that converts it into one of a few pre-defined “actions” that he’s able to take- insert and delete, to start

He should also have the ability to “refactor” in place a small selection of code (much simpler)

--

Finally, give him the ability to “think” - to take the first 100 or so (configurable) most relevant embedding, tsvector and relevant type results, and break the task into a variable number of “sub-tasks”, where each subtask is then run as a task. It could be recursive, if that turns out to be useful

--

Now let’s add the idea of actions. This will be configurable per-template-function with a jsdoc directive

Actions are scripts that are sandboxed - unable to make fetch calls or read/write outside of the repo directory - and they have access to a rich api of the extension’s abilities - make a semantic search, get back type or tsvector results, run a “task” with Jerry.

Importing them is very similar to importing anything in ts. They can be run as one offs, or suggested when they are referenced in the jsdoc

These are meant to make it easier to add/modify Postgres tables, tailwind config etc . They’re also given a robust UI api, with the abiltity to ask users questions, and build modals with text, datalists, checkboxes and multiselect.

# Initial Brainstorm

## Embedding Server

Theres a server running (controlled by vscode, much like eslint) that is constantly populating a vector database with semantic information using a cheap pre trained model. One entry for each function/value, and each function is joined via foreign key with each of its sub-functions as well

The embeddings are also stored with type information from tsc and or the lsp, and with a tsvector of the function contents/name/whatever makes the most sense

And the vscode plugin allows you to do a semantic search on all functions/values and insert the result wherever your cursor is, and auto-add the needed import statements. Results are ranked by relevance, whether the return type matches the cursor area, etc

### Big hurdles

- Incremental indexing is tricky. When a file changes, you need to re-extract its functions, diff against what's in the DB, delete stale embeddings, and insert new ones — without blocking. This is solvable but requires careful bookkeeping (hash of file content stored in DB).
- Type extraction at index time vs query time. At index time you can get return types. At query time you need the expected type at cursor. Getting that cleanly from VSCode requires using the completion provider API or parsing surrounding context — it's not a single clean call.
- Cold start on large repos. First-time indexing a 200k-line monorepo will take minutes even with a fast embedding model. You need to show progress and not block the editor. After that, incremental updates are fast.

### Parsing TS

(hardest part, don't underestimate)

You need to extract functions/consts with their signatures, JSDoc, and dependency edges. The right tool is `ts-morph` (TypeScript compiler API wrapper) — not tree-sitter. Tree-sitter gives you syntax; ts-morph gives you the type checker, which you need for:

- inferring return types of functions with no explicit annotation
- resolving what a const foo = bar(baz) actually returns
- getting the full type of parameters

The LSP is the alternative path — you can query textDocument/hover and textDocument/definition — but ts-morph gives you a batch API that's much faster for full-repo indexing.

### Embedding model

For self-hosted on cheap hardware, the realistic options are:

- nomic-embed-code or nomic-embed-text-v1.5 — 768-dim, runs fine on CPU, ~50ms per embedding on a modern CPU
- all-MiniLM-L6-v2 — smaller/faster but less code-aware
- CodeBERT or GraphCodeBERT — more code-aware but heavier

LLM useful at setup/indexing time (one-off, not latency-sensitive):

Generating rich natural language descriptions of each hotspot destination ("this array holds Express route handlers for the user management API, each taking Request and Response...") — you could use a small local model like Qwen 2.5 3B or Phi-4-mini for this, run once, store the result
Generating synthetic query→destination training pairs if you later want to fine-tune

The tiers:
Best quality, API (subscription):

- Voyage Code 3 — best-in-class for code retrieval specifically, now part of Anthropic. The benchmark leader for code quality-aware retrieval. This is your recommended paid option.
- OpenAI text-embedding-3-large — still solid but hasn't been updated since January 2024, now ranking 7th-9th depending on benchmark. Fine but not the best choice anymore.
- Gemini Embedding 2 — leads retrieval benchmarks overall with a 67.71 MTEB retrieval score, but its weakness is MRL compression. Strong general model, not code-specific.

Best self-hosted:

- Nomic Embed Code — code-specific, Apache 2.0, open weights. Your best self-hosted option for this use case specifically. Runs via Ollama.
- nomic-embed-text-v1.5 — 137M parameters, small enough to run on CPU in production, supports Matryoshka dimensions from 768 down to 64, long context up to 8192 tokens. This is the practical default for users without a GPU — fast, free, good enough.
- BGE-M3 — a good free self-hosted multilingual choice, produces both dense and sparse vectors in one call which simplifies your hybrid search setup. Worth considering if you want to skip the separate FTS5 layer.

Best three for my use case:

- Local/free → nomic-embed-text-v1.5 via Ollama. Runs on any machine, no API key, good quality.
- Local/best → nomic-embed-code via Ollama. Needs ~8GB RAM, noticeably better on code.
- API/best → voyage-code-3. Best retrieval quality, costs fractions of a cent per indexing run, requires an API key.

### Vector DB

sqlite-vec is the right call here, not a separate process. It's a SQLite extension — one file, zero infrastructure, fast enough for tens of thousands of functions. You can store your foreign-key graph (function → sub-functions) in the same SQLite file alongside the vectors. pgvector is overkill; Chroma/Qdrant add operational complexity for no gain at this scale.

## Hotspot Classification & Cursor-Location Search

You have two sub-problems:

1. Destination classification — given an English description of intent, predict where in the repo this thing belongs (which hotspot array, or which function to append to)
2. Candidate ranking — given that destination, rank which existing functions are the best fit to insert there

### Destination classification

At query time you embed the English input and do cosine similarity against all destinations. No training data needed, works with 5 destinations or 500.

The destination embeddings can be partly auto-generated from your existing graph data (the function members of each hotspot tell you a lot about what belongs there).

> Could a small qwen model reasonably be used to help do destination classification?

The harder question isn't where in the syntax but which of several valid insertion points is the right one semantically. If a file has three different route arrays — admin routes, user routes, public routes — and you're inserting a ban function, picking the right array is a semantic judgment.
That's the classification problem worth giving to the LLM. And for that, you don't need to pass the full function body at all — just the array names, their existing members, and the candidate function signature. That's maybe 200 tokens, not 900.

### Candidate Ranking

Here you can do pure vector search + hard type filter + rerank with no LLM:

1. Embed the English query
1. Filter candidates by type compatibility (hard constraint from TypeScript)
1. Score by: semantic similarity to query + semantic similarity to existing members of the destination (you want something that "fits in" with what's already there)
1. Optionally rerank with a tiny cross-encoder model

The graph structure is your secret weapon here
Most RAG systems treat the corpus as a flat bag of documents. You have a graph. That changes things significantly.
For destination prediction specifically: if the user's English input semantically matches function F, and F is a known member of hotspot H, that's strong evidence the destination is H. You can propagate: the destination is likely wherever semantically-similar functions already live. This is a graph walk informed by embeddings, and it's fast and requires no LLM.
For candidate ranking: the graph lets you do context-aware retrieval. If you're inserting into a hotspot that's three levels deep inside userManagementModule → adminRoutes → [hotspot], the ancestry path gives you additional semantic context to bias the search. Functions used elsewhere in that subtree are more likely to be relevant.

## Step-Generation ("thinking")

Latency expectation
On a machine with no GPU, Qwen 2.5 3B quantized to 4-bit via llama.cpp:

- Context encoding (your prompt + candidates): ~500ms
- Generation of a 5-step JSON plan: ~1-3 seconds

That's not instant, but it's acceptable for a deliberate "generate a plan" action rather than an inline suggestion. You show a spinner, the plan appears, the user reviews and confirms before anything gets inserted. The non-realtime nature of this step actually fits the UX naturally.

# Inspiration & Research

https://github.com/Gabriella439/semantic-navigator

https://haskellforall.com/2026/02/beyond-agentic-coding

Similar

- semantic-navigator itself — but it indexes files, not functions, and clusters for browsing rather than search-and-insert
- GitHub Copilot's local index — does something similar internally but it's a black box, cloud-dependent, and not function-granular
- Sourcegraph Cody — semantic code search, but again cloud-dependent, chat-oriented, not insert-by-type
- Zed's semantic index — local, fast, but file-level and not VSCode
- tree-sitter + embeddings hacks people have built for Neovim
