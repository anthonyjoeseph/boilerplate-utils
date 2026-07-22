/**
 * Jest adapter for the spec corpus.
 *
 * Everything meaningful lives in `runSpec.ts`, which is framework-agnostic;
 * this file only maps outcomes onto assertions. Moving the package to vitest is
 * therefore a change to this file alone.
 */
import * as path from "path";

import { loadCorpus } from "./corpus";
import { checkSpec, type SpecCase, type SpecOutcome } from "./runSpec";

const corpus = loadCorpus(path.join(__dirname, "cases"));

const failureMessage = (outcome: SpecOutcome): string => {
  if (outcome.ok) return "";
  return outcome.detail
    ? `${outcome.reason}\n\n${outcome.detail}`
    : outcome.reason;
};

const titleFor = (kase: SpecCase): string => {
  if (kase.config.known !== "broken") return kase.name;
  const reason = kase.config.reason ? `: ${kase.config.reason}` : "";
  return `${kase.name} [known broken${reason}]`;
};

describe("behavioral specs", () => {
  it("finds at least one spec", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  describe.each(corpus.map((kase) => [titleFor(kase), kase] as const))(
    "%s",
    (_title, kase) => {
      if (kase.config.known === "broken") {
        // Inverted assertion. The known-broken list stays executable, so the
        // suite is green while the bugs are open and shouts the moment one is
        // fixed - which is when the entry needs deleting.
        it("still fails (delete `known: broken` once it passes)", async () => {
          const outcome = await checkSpec(kase);
          if (outcome.ok) {
            throw new Error(
              `"${kase.name}" now passes. Remove \`"known": "broken"\` from its spec.json.`
            );
          }
          expect(outcome.ok).toBe(false);
        });
        return;
      }

      it("preserves behavior", async () => {
        const outcome = await checkSpec(kase);
        if (!outcome.ok) throw new Error(failureMessage(outcome));
        expect(outcome.ok).toBe(true);
      });
    }
  );
});
