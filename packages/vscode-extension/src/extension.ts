import * as vscode from "vscode";

import { handleSmartInline, VscodeApi } from "./commandHandlers";

function isSupportedLanguage(languageId: string): boolean {
  return languageId === "typescript" || languageId === "typescriptreact";
}

function runWithEditor(
  vscodeApi: VscodeApi,
  _commandName: string,
  unsupportedMessage: string,
  handler: (vscodeApi: VscodeApi, editor: vscode.TextEditor) => Promise<void>
): () => Promise<void> {
  return async () => {
    const editor = vscodeApi.window.activeTextEditor;
    if (!editor) {
      vscodeApi.window.showErrorMessage("No active editor.");
      return;
    }
    if (!isSupportedLanguage(editor.document.languageId)) {
      vscodeApi.window.showErrorMessage(unsupportedMessage);
      return;
    }
    await handler(vscodeApi, editor);
  };
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "smartInlineFunction.inline",
      runWithEditor(
        vscode,
        "Smart Inline",
        "Smart Inline only supports TypeScript/TSX files.",
        handleSmartInline
      )
    )
  );
}

export function deactivate() {
  // no-op
}
