/**
 * Collects which names are imported in a source file and which of those
 * are used in an expression (for adding missing imports when inlining).
 */

import * as ts from "typescript";

export interface ImportedNameIndex {
  byName: Map<string, ts.ImportDeclaration>;
  byModule: Map<string, ts.ImportDeclaration[]>;
  getAllByModule(module: string): ts.ImportDeclaration[];
}

export function collectImportedNames(
  fnSourceFile: ts.SourceFile
): ImportedNameIndex {
  const byName = new Map<string, ts.ImportDeclaration>();
  const byModule = new Map<string, ts.ImportDeclaration[]>();

  for (const stmt of fnSourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const moduleSpecifier = (stmt.moduleSpecifier as ts.StringLiteral).text;

    const list = byModule.get(moduleSpecifier) ?? [];
    list.push(stmt);
    byModule.set(moduleSpecifier, list);

    const clause = stmt.importClause;

    if (clause.name) {
      byName.set(clause.name.text, stmt);
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        byName.set(el.name.text, stmt);
      }
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      byName.set(clause.namedBindings.name.text, stmt);
    }
  }

  return {
    byName,
    byModule,
    getAllByModule(module: string) {
      return byModule.get(module) ?? [];
    }
  };
}

export function collectUsedImportedNames(
  node: ts.Node,
  importedNames: ImportedNameIndex
): ts.ImportDeclaration[] {
  const used = new Set<ts.ImportDeclaration>();

  function visit(n: ts.Node) {
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      // Ignore identifiers that are merely property names (obj.prop).
      // Guard against undefined parent — synthesized nodes may lack parent pointers.
      if (parent && ts.isPropertyAccessExpression(parent) && parent.name === n) {
        return;
      }
      const decl = importedNames.byName.get(n.text);
      if (decl) {
        used.add(decl);
      }
    }
    n.forEachChild(visit);
  }

  visit(node);
  return Array.from(used);
}

/** Every identifier referenced in `node`, ignoring property names (`obj.prop`). */
export function collectReferencedNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  function visit(n: ts.Node): void {
    if (ts.isIdentifier(n)) {
      const parent = n.parent;
      if (!(parent && ts.isPropertyAccessExpression(parent) && parent.name === n)) {
        names.add(n.text);
      }
    }
    n.forEachChild(visit);
  }
  visit(node);
  return names;
}

/**
 * The same import declaration with only the bindings `used` actually mentions,
 * or undefined if it mentions none. A declaration is pulled in because one of
 * its names is needed; copying it whole would add the rest as unused imports.
 */
export function narrowImportToUsedNames(
  decl: ts.ImportDeclaration,
  used: Set<string>
): ts.ImportDeclaration | undefined {
  const clause = decl.importClause;
  if (!clause) return decl;

  const defaultName = clause.name && used.has(clause.name.text) ? clause.name : undefined;

  let namedBindings: ts.NamedImportBindings | undefined;
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      if (used.has(clause.namedBindings.name.text)) {
        namedBindings = clause.namedBindings;
      }
    } else {
      const elements = clause.namedBindings.elements.filter((el) =>
        used.has(el.name.text)
      );
      if (elements.length === clause.namedBindings.elements.length) {
        namedBindings = clause.namedBindings;
      } else if (elements.length > 0) {
        namedBindings = ts.factory.updateNamedImports(clause.namedBindings, elements);
      }
    }
  }

  if (!defaultName && !namedBindings) return undefined;
  if (defaultName === clause.name && namedBindings === clause.namedBindings) return decl;

  return ts.factory.updateImportDeclaration(
    decl,
    decl.modifiers,
    ts.factory.updateImportClause(clause, clause.isTypeOnly, defaultName, namedBindings),
    decl.moduleSpecifier,
    decl.attributes
  );
}
