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
