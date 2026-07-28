/**
 * Types for the CRM-0 projection-invariant guardrail.
 *
 * The implementation is deliberately plain `.mjs` with zero dependencies so CI
 * can run it without `npm ci` — its verdict must never be maskable by an
 * unrelated install/lint/type failure. This declaration exists only so the
 * meta-test (tests/unit/projection-invariant.test.ts) can import it under
 * `allowJs: false`.
 */

export type ProjectionInvariantViolation = {
  /** The guarded Growth OS model that matched. */
  model: string;
  /** The exact surface form that matched (Pascal/camel, singular/plural). */
  form: string;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column number. */
  column: number;
  /** The trimmed source line. */
  text: string;
};

/** Every Growth OS model that must stay Prisma-native (Plan v9.1 §6). */
export declare const GUARDED_MODELS: string[];

/** The file the invariant protects, relative to the repo root. */
export declare const PROJECTION_FILE: string;

/** The four spellings a model can wear in this codebase. */
export declare function surfaceFormsFor(model: string): string[];

/** The matcher for one surface form (PascalCase: anywhere; camelCase: structural only). */
export declare function patternFor(form: string): RegExp;

/** Scan source text for guarded names. */
export declare function findViolations(
  source: string,
  models?: string[]
): ProjectionInvariantViolation[];
