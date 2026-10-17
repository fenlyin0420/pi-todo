/**
 * Local stand-in for the few `@juicesharp/rpiv-workflow` host-port types that
 * the vendored `pi.ts` fixtures reference.
 *
 * `packages/test-utils` in rpiv-mono imports them from the workspace package;
 * this repo has no rpiv-workflow dependency, and every reference is type-only
 * (erased at runtime). Declaring them loosely here keeps the fixture file
 * byte-identical to upstream apart from the import specifier, so re-syncing
 * the vendored copy stays a one-line diff.
 *
 * The workflow-specific fixtures (`createMockCommandCtx`, `createMockSessionChain`)
 * are unused by the todo suite; the loose types simply let the file typecheck.
 */

export type ModelSelection = unknown;
export type WorkflowHostContext = object;
export type WorkflowSessionContext = unknown;
