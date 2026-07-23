/**
 * Command handlers: the "product" layer that uses runners and drives
 * vscode.window (showErrorMessage) and editor.edit. Used by the extension
 * and by tests with a mocked vscode so we test the same code path as production.
 */

import * as path from "path";
import * as ts from "typescript";
import type * as vscode from "vscode";

import { runInline } from "./commandRunners";

/** Minimal vscode API needed by handlers; tests pass a mock that satisfies this. */
export interface VscodeApi {
  Range: typeof vscode.Range;
  window: {
    showErrorMessage: (message: string) => void;
    showInformationMessage: (message: string) => void;
    activeTextEditor: vscode.TextEditor | undefined;
  };
  workspace: {
    getWorkspaceFolder?: (
      uri: vscode.Uri
    ) => { uri: { fsPath: string } } | undefined;
  };
}

function getWorkspaceRoot(
  vscodeApi: VscodeApi,
  document: { fileName: string; uri: vscode.Uri }
): string {
  const folder = vscodeApi.workspace?.getWorkspaceFolder?.(document.uri);
  return folder ? folder.uri.fsPath : path.dirname(document.fileName);
}

function scriptKind(languageId: string): "ts" | "tsx" {
  return languageId === "typescriptreact" ? "tsx" : "ts";
}

/**
 * Handler for the unified Smart Inline command (`smartInlineFunction.inline`).
 *
 * It classifies what the selection points at and dispatches to one of four
 * behaviors — relocate a function body, evaluate a `.map(...)`, evaluate an
 * `Object.fromEntries(...)`, or fold an expression — then applies the edit
 * (replace + optional import insertion). The name is retained because the
 * surviving command is `smartInlineFunction.inline`.
 */
export async function handleSmartInline(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor
): Promise<void> {
  try {
    await doHandleSmartInline(vscodeApi, editor);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscodeApi.window.showErrorMessage(`Smart Inline failed: ${message}`);
  }
}

async function doHandleSmartInline(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor
): Promise<void> {
  const document = editor.document;
  const sourceText = document.getText();
  const selection = editor.selection;
  const offsetStart = document.offsetAt(selection.start);
  const offsetEnd = document.offsetAt(selection.end);
  const workspaceRoot = getWorkspaceRoot(vscodeApi, document);

  const result = await runInline({
    sourceText,
    start: offsetStart,
    end: offsetEnd,
    fileName: document.fileName,
    workspaceRoot,
    scriptKind: scriptKind(document.languageId)
  });

  if (!result.ok) {
    vscodeApi.window.showErrorMessage(result.error);
    return;
  }

  // Detect no-ops: if the inlined expression is identical to the original
  // source text, applying the edit would be a silent no-op. Report it instead.
  const originalText = sourceText.slice(result.replaceStart, result.replaceEnd);
  if (result.expression === originalText) {
    vscodeApi.window.showInformationMessage(
      "Smart Inline: nothing to simplify — the expression is already in its simplest form."
    );
    return;
  }

  await editor.edit((editBuilder) => {
    const existingText = document.getText();
    const toAdd = result.neededImportTexts.filter(
      (line) => !existingText.includes(line)
    );
    if (toAdd.length > 0) {
      const callerSourceFile = ts.createSourceFile(
        document.fileName,
        existingText,
        ts.ScriptTarget.Latest,
        true,
        document.languageId === "typescriptreact"
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS
      );
      const existingImports = callerSourceFile.statements.filter((s) =>
        ts.isImportDeclaration(s)
      );
      const lastImport = existingImports[existingImports.length - 1];
      const insertOffset = lastImport ? lastImport.getEnd() : 0;
      editBuilder.insert(document.positionAt(insertOffset), toAdd.join(""));
    }
    const range = new vscodeApi.Range(
      document.positionAt(result.replaceStart),
      document.positionAt(result.replaceEnd)
    );
    editBuilder.replace(range, result.expression);
  });

  const behaviorLabels: Record<string, string> = {
    "smart-inline": "Inlined function body",
    "literal-inline": "Folded to literal value",
    "literal-inline-array": "Evaluated .map() to array literal",
    "literal-inline-object": "Evaluated Object.fromEntries() to object literal"
  };
  vscodeApi.window.showInformationMessage(
    `Smart Inline: ${behaviorLabels[result.behavior] ?? result.behavior}`
  );
}
