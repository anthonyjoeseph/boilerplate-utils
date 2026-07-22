/**
 * Control-flow reduction: if/else chains and switch statements to single
 * expressions when conditions are constant after substitution.
 */

import * as ts from "typescript";
import { getBooleanLiteralValue, isSimpleLiteral } from "./inliningConst";
import { substituteAndSimplifyExpression } from "./inliningSubstitute";

export interface IfBranch {
  condition?: ts.Expression | undefined; // undefined for final else
  returnExpr: ts.Expression;
}

export function extractReturnExpressionFromStatement(
  stmt: ts.Statement
): ts.Expression | undefined {
  if (ts.isReturnStatement(stmt) && stmt.expression) {
    return stmt.expression;
  }
  if (ts.isBlock(stmt) && stmt.statements.length === 1) {
    const inner = stmt.statements[0];
    if (inner && ts.isReturnStatement(inner) && inner.expression) {
      return inner.expression;
    }
  }
  return undefined;
}

function collectIfBranches(ifStmt: ts.IfStatement): IfBranch[] | undefined {
  const branches: IfBranch[] = [];
  let current: ts.IfStatement | undefined = ifStmt;

  while (current) {
    const thenExpr = extractReturnExpressionFromStatement(
      current.thenStatement
    );
    if (!thenExpr) {
      return undefined;
    }
    branches.push({ condition: current.expression, returnExpr: thenExpr });

    const elseStmt: ts.Statement | undefined = current.elseStatement;
    if (!elseStmt) {
      current = undefined;
    } else if (ts.isIfStatement(elseStmt)) {
      current = elseStmt;
    } else {
      const elseExpr = extractReturnExpressionFromStatement(elseStmt);
      if (!elseExpr) {
        return undefined;
      }
      branches.push({ condition: undefined, returnExpr: elseExpr });
      current = undefined;
    }
  }

  return branches;
}

export function tryReduceIfElseChainToExpression(
  body: ts.Block,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>
): ts.Expression | undefined {
  if (body.statements.length !== 1) {
    return undefined;
  }
  const first = body.statements[0];
  if (!first || !ts.isIfStatement(first)) {
    return undefined;
  }

  const branches = collectIfBranches(first);
  if (!branches || branches.length === 0) {
    return undefined;
  }

  const lastBranch = branches[branches.length - 1];
  if (!lastBranch) {
    return undefined;
  }
  const hasElse = lastBranch.condition === undefined;
  const condBranches = hasElse ? branches.slice(0, -1) : branches;

  const condValues: boolean[] = [];

  for (const branch of condBranches) {
    if (!branch.condition) {
      return undefined;
    }
    const simplifiedCond = substituteAndSimplifyExpression(
      branch.condition,
      argMap,
      paramConstEnv
    );
    const boolVal = getBooleanLiteralValue(simplifiedCond);
    if (boolVal === undefined) {
      // Condition is not statically true/false after substitution -> cannot safely reduce.
      return undefined;
    }
    condValues.push(boolVal);
  }

  let chosenReturnExpr = condBranches.find(
    (_, i) => condValues[i]
  )?.returnExpr;

  if (!chosenReturnExpr) {
    if (hasElse) {
      chosenReturnExpr = lastBranch.returnExpr;
    } else {
      return undefined;
    }
  }

  // Now substitute and simplify within the chosen return expression.
  return substituteAndSimplifyExpression(
    chosenReturnExpr,
    argMap,
    paramConstEnv
  );
}

function literalsEqual(a: ts.Expression, b: ts.Expression): boolean {
  const aBool = getBooleanLiteralValue(a);
  const bBool = getBooleanLiteralValue(b);
  if (aBool !== undefined || bBool !== undefined) {
    return aBool === bBool && aBool !== undefined;
  }

  if (ts.isNumericLiteral(a) && ts.isNumericLiteral(b)) {
    return Number(a.text) === Number(b.text);
  }
  if (ts.isStringLiteral(a) && ts.isStringLiteral(b)) {
    return a.text === b.text;
  }

  return false;
}

export function tryReduceSwitchToExpression(
  body: ts.Block,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>
): ts.Expression | undefined {
  if (body.statements.length !== 1) {
    return undefined;
  }

  const first = body.statements[0];
  if (!first || !ts.isSwitchStatement(first)) {
    return undefined;
  }

  // Evaluate the discriminant after substitution/const-eval.
  const simplifiedDiscriminant = substituteAndSimplifyExpression(
    first.expression,
    argMap,
    paramConstEnv
  );

  if (!isSimpleLiteral(simplifiedDiscriminant)) {
    // For now, only handle literal discriminants that we can compare directly.
    return undefined;
  }

  let defaultReturnExpr: ts.Expression | undefined;

  for (const clause of first.caseBlock.clauses) {
    // Each clause must be a simple "return ..." (possibly wrapped in a block).
    if (ts.isCaseClause(clause)) {
      if (!clause.expression) continue;

      const simplifiedCaseExpr = substituteAndSimplifyExpression(
        clause.expression,
        argMap,
        paramConstEnv
      );

      if (!isSimpleLiteral(simplifiedCaseExpr)) {
        return undefined;
      }

      if (!literalsEqual(simplifiedDiscriminant, simplifiedCaseExpr)) {
        continue;
      }

      const onlyStatement = clause.statements[0];
      if (clause.statements.length !== 1 || !onlyStatement) {
        return undefined;
      }
      const returnExpr = extractReturnExpressionFromStatement(onlyStatement);
      if (!returnExpr) {
        return undefined;
      }
      return substituteAndSimplifyExpression(returnExpr, argMap, paramConstEnv);
    } else {
      // Default clause
      const onlyStatement = clause.statements[0];
      if (clause.statements.length !== 1 || !onlyStatement) {
        return undefined;
      }
      const returnExpr = extractReturnExpressionFromStatement(onlyStatement);
      if (!returnExpr) {
        return undefined;
      }
      defaultReturnExpr = returnExpr;
    }
  }

  if (!defaultReturnExpr) {
    return undefined;
  }

  return substituteAndSimplifyExpression(
    defaultReturnExpr,
    argMap,
    paramConstEnv
  );
}
