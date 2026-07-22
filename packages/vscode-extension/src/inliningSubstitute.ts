/**
 * Expression substitution and simplification: replace parameters with arguments
 * and fold constant subexpressions (literals, ternaries, binary ops, spreads).
 */

import * as ts from "typescript";
import {
  getBooleanLiteralValue,
  getTruthinessValue,
  isDeepConstExpr,
  isSimpleLiteral,
  resolveConstExpression
} from "./inliningConst";

export function substituteAndSimplifyExpression(
  expr: ts.Expression,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>,
  conditionMode = false
): ts.Expression {
  const factory = ts.factory;

  /**
   * Build a numeric literal node for `value`.
   *
   * `factory.createNumericLiteral` throws a TypeScript Debug Failure on a
   * negative value — the AST has no negative numeric literal, only a unary
   * minus applied to a positive one. Any fold that goes negative (`a - b`,
   * `-a`, a multiply by a negative constant) hits this, so every numeric fold
   * must route through here.
   */
  function createNumberLiteral(value: number): ts.Expression {
    return value < 0
      ? factory.createPrefixUnaryExpression(
          ts.SyntaxKind.MinusToken,
          factory.createNumericLiteral(-value)
        )
      : factory.createNumericLiteral(value);
  }

  function evalLiteralExpression(node: ts.Expression): unknown | undefined {
    if (paramConstEnv.size > 0) {
      const constExpr = resolveConstExpression(node, paramConstEnv, 0);
      if (constExpr && isDeepConstExpr(constExpr)) {
        const v = evalLiteralExpression(constExpr);
        if (v !== undefined) return v;
      }
    }

    {
      const b = getBooleanLiteralValue(node);
      if (b !== undefined) return b;
    }
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isPrefixUnaryExpression(node)) {
      const v = evalLiteralExpression(node.operand);
      if (v === undefined) return undefined;
      switch (node.operator) {
        case ts.SyntaxKind.ExclamationToken:
          return !v;
        case ts.SyntaxKind.PlusToken:
          if (v == null) throw new Error("Cannot convert null to number");
          return +v;
        case ts.SyntaxKind.MinusToken:
          if (v == null) throw new Error("Cannot negate null");
          return -v;
        default:
          return undefined;
      }
    }
    if (ts.isParenthesizedExpression(node)) {
      return evalLiteralExpression(node.expression);
    }
    if (ts.isBinaryExpression(node)) {
      const left: unknown = evalLiteralExpression(node.left);
      const right: unknown = evalLiteralExpression(node.right);
      if (left === undefined || right === undefined) return undefined;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
          return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          return left !== right;
        // EqualsEqualsToken (==) and ExclamationEqualsToken (!=) use loose
        // equality semantics (e.g. "1" == 1 is true) which we cannot replicate
        // with strict ===. Leave them unfolded.
        case ts.SyntaxKind.LessThanToken:
          return (left as number) < (right as number);
        case ts.SyntaxKind.LessThanEqualsToken:
          return (left as number) <= (right as number);
        case ts.SyntaxKind.GreaterThanToken:
          return (left as number) > (right as number);
        case ts.SyntaxKind.GreaterThanEqualsToken:
          return (left as number) >= (right as number);
        case ts.SyntaxKind.PlusToken:
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          return (left as number) + (right as number);
        case ts.SyntaxKind.MinusToken:
          return (left as number) - (right as number);
        case ts.SyntaxKind.AsteriskToken:
          return (left as number) * (right as number);
        case ts.SyntaxKind.SlashToken:
          return (left as number) / (right as number);
        default:
          return undefined;
      }
    }
    return undefined;
  }

  const nullTransformationContext = {
    factory: ts.factory,
    enableEmitNotification: () => {},
    enableSubstitution: () => {},
    endLexicalEnvironment: () => [],
    getCompilerOptions: () => ({}) as ts.CompilerOptions,
    getEmitHost: () => ({}),
    getEmitResolver: () => ({}),
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    isEmitNotificationEnabled: () => false,
    isSubstitutionEnabled: () => false,
    onEmitNode: (
      _hint: ts.EmitHint,
      node: ts.Node,
      emit: (hint: ts.EmitHint, node: ts.Node) => void
    ) => emit(_hint, node),
    onSubstituteNode: (_hint: ts.EmitHint, node: ts.Node) => node,
    readEmitHelpers: () => undefined,
    requestEmitHelper: () => {},
    resumeLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    getLexicalEnvironmentFlags: () => 0,
    setLexicalEnvironmentFlags: () => {},
    startLexicalEnvironment: () => {}
  } as unknown as ts.TransformationContext;

  function simplify(node: ts.Expression, inConditionContext = conditionMode): ts.Expression {
    // Substitute identifiers.
    // When in a condition context (ternary condition, if/else, switch discriminant),
    // prefer the statically-known const value over the raw argument so conditions like
    // `if (f)` can be evaluated when `f` was bound to a caller const. Outside condition
    // contexts, use the raw argument expression to preserve variable names.
    if (ts.isIdentifier(node)) {
      if (inConditionContext) {
        const constVal = paramConstEnv.get(node.text);
        if (constVal !== undefined && isSimpleLiteral(constVal)) {
          return constVal;
        }
      }
      const arg = argMap.get(node.text);
      if (arg) {
        return simplify(arg, inConditionContext);
      }
      return node;
    }

    // Conditional (ternary) operator
    if (ts.isConditionalExpression(node)) {
      const cond = simplify(node.condition, true);
      const whenTrue = simplify(node.whenTrue, false);
      const whenFalse = simplify(node.whenFalse, false);
      const condVal = evalLiteralExpression(cond);
      if (condVal === true) {
        return whenTrue;
      }
      if (condVal === false) {
        return whenFalse;
      }
      return factory.createConditionalExpression(
        cond,
        node.questionToken,
        whenTrue,
        node.colonToken,
        whenFalse
      );
    }

    // Parentheses
    if (ts.isParenthesizedExpression(node)) {
      const inner = simplify(node.expression);
      return factory.createParenthesizedExpression(inner);
    }

    // Template literals
    if (ts.isTemplateExpression(node)) {
      const headText = node.head.text;
      let fullText = headText;
      let allLiteral = true;

      for (const span of node.templateSpans) {
        const exprSimplified = simplify(span.expression);
        const exprVal = evalLiteralExpression(exprSimplified);
        if (typeof exprVal !== "string") {
          allLiteral = false;
        } else {
          fullText += exprVal;
        }
        fullText += span.literal.text;
      }

      if (allLiteral) {
        return factory.createNoSubstitutionTemplateLiteral(fullText);
      }

      const newSpans = node.templateSpans.map((span) =>
        factory.createTemplateSpan(simplify(span.expression), span.literal)
      );
      return factory.createTemplateExpression(node.head, newSpans);
    }

    // Binary
    if (ts.isBinaryExpression(node)) {
      const left = simplify(node.left);
      const right = simplify(node.right);

      // Short-circuit logical operators before general constant folding.
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        const lt = getTruthinessValue(left);
        if (lt === false) return left;  // a && b  ≡  a  when a is falsy
        if (lt === true) return right;   // a && b  ≡  b  when a is truthy
      } else if (op === ts.SyntaxKind.BarBarToken) {
        const lt = getTruthinessValue(left);
        if (lt === true) return left;    // a || b  ≡  a  when a is truthy
        if (lt === false) return right;  // a || b  ≡  b  when a is falsy
      } else if (op === ts.SyntaxKind.QuestionQuestionToken) {
        const isNullish =
          left.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isIdentifier(left) && left.text === "undefined");
        if (isNullish) return right;
        if (isSimpleLiteral(left)) return left; // known non-nullish scalar
      }

      const synthetic = factory.createBinaryExpression(
        left,
        node.operatorToken,
        right
      );
      const val = evalLiteralExpression(synthetic);
      if (val !== undefined) {
        if (typeof val === "boolean") {
          return val ? factory.createTrue() : factory.createFalse();
        }
        if (typeof val === "number") {
          return createNumberLiteral(val);
        }
        if (typeof val === "string") {
          return factory.createStringLiteral(val);
        }
      }
      return synthetic;
    }

    // Prefix unary
    if (ts.isPrefixUnaryExpression(node)) {
      const operand = simplify(node.operand);
      const synthetic = factory.createPrefixUnaryExpression(
        node.operator,
        operand
      );
      const val = evalLiteralExpression(synthetic);
      if (val !== undefined) {
        if (typeof val === "boolean") {
          return val ? factory.createTrue() : factory.createFalse();
        }
        if (typeof val === "number") {
          return createNumberLiteral(val);
        }
      }
      return synthetic;
    }

    // Array literals with literal-safe spreads
    if (ts.isArrayLiteralExpression(node)) {
      const elements: ts.Expression[] = [];
      let changed = false;

      for (const el of node.elements) {
        if (ts.isSpreadElement(el)) {
          const spreadExprSimplified = simplify(el.expression);
          const resolved =
            paramConstEnv.size > 0
              ? (resolveConstExpression(
                  spreadExprSimplified,
                  paramConstEnv,
                  0
                ) ?? spreadExprSimplified)
              : spreadExprSimplified;

          if (
            ts.isArrayLiteralExpression(resolved) &&
            isDeepConstExpr(resolved)
          ) {
            for (const inner of resolved.elements) {
              if (ts.isExpression(inner)) {
                elements.push(simplify(inner as ts.Expression));
              }
            }
            changed = true;
          } else {
            if (resolved !== el.expression) {
              changed = true;
            }
            elements.push(factory.createSpreadElement(resolved));
          }
        } else {
          const simpleEl = simplify(el as ts.Expression);
          if (simpleEl !== el) {
            changed = true;
          }
          elements.push(simpleEl);
        }
      }

      if (!changed) {
        return node;
      }
      return factory.createArrayLiteralExpression(
        elements,
        /*multiLine*/ false
      );
    }

    // Object literals with literal-safe spreads
    if (ts.isObjectLiteralExpression(node)) {
      const properties: ts.ObjectLiteralElementLike[] = [];
      let changed = false;

      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) {
          const spreadExprSimplified = simplify(prop.expression);
          const resolved =
            paramConstEnv.size > 0
              ? (resolveConstExpression(
                  spreadExprSimplified,
                  paramConstEnv,
                  0
                ) ?? spreadExprSimplified)
              : spreadExprSimplified;

          if (
            ts.isObjectLiteralExpression(resolved) &&
            isDeepConstExpr(resolved)
          ) {
            for (const inner of resolved.properties) {
              if (ts.isPropertyAssignment(inner)) {
                const init = inner.initializer;
                if (ts.isExpression(init)) {
                  const newInit = simplify(init);
                  const newProp = factory.createPropertyAssignment(
                    inner.name,
                    newInit
                  );
                  properties.push(newProp);
                }
              } else {
                properties.push(factory.createSpreadAssignment(resolved));
                break;
              }
            }
            changed = true;
          } else {
            if (resolved !== prop.expression) {
              changed = true;
            }
            properties.push(factory.createSpreadAssignment(resolved));
          }
        } else if (ts.isPropertyAssignment(prop)) {
          const init = prop.initializer;
          if (ts.isExpression(init)) {
            const newInit = simplify(init);
            if (newInit !== init) {
              changed = true;
            }
            properties.push(
              factory.createPropertyAssignment(prop.name, newInit)
            );
          } else {
            properties.push(prop);
          }
        } else {
          properties.push(prop);
        }
      }

      if (!changed) {
        return node;
      }

      return factory.createObjectLiteralExpression(
        properties,
        /*multiLine*/ false
      );
    }

    // Property access: only simplify the object, never the name — the name is
    // a property key, not a variable reference, and must not be substituted.
    // Must be `update`, not `create`: a fresh node has no questionDotToken, so
    // `o?.b` would silently become `o.b`. The update helpers delegate to
    // updatePropertyAccessChain when the node is an optional chain.
    if (ts.isPropertyAccessExpression(node)) {
      const obj = simplify(node.expression);
      if (obj === node.expression) return node;
      return factory.updatePropertyAccessExpression(node, obj, node.name);
    }

    // Element access: simplify both object and index expression. Same
    // create-vs-update reasoning as above, for `a?.[i]`.
    if (ts.isElementAccessExpression(node)) {
      const obj = simplify(node.expression);
      const idx = simplify(node.argumentExpression);
      if (obj === node.expression && idx === node.argumentExpression) return node;
      return factory.updateElementAccessExpression(node, obj, idx);
    }

    // Call inside expression: still substitute args where possible
    if (ts.isCallExpression(node)) {
      const callee = simplify(node.expression);
      const newArgs = node.arguments.map((arg) => simplify(arg));
      return ts.factory.updateCallExpression(
        node,
        callee,
        node.typeArguments,
        newArgs
      );
    }

    // Fallback: recursively visit children for substitution only
    return ts.visitEachChild(
      node,
      (child) => (ts.isExpression(child) ? simplify(child) : child),
      nullTransformationContext
    ) as ts.Expression;
  }

  return simplify(expr);
}
