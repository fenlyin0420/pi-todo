/**
 * Test setup — trimmed from `test/setup.ts` in rpiv-mono.
 *
 * Two jobs the suite depends on:
 *
 * 1. Sandbox `$HOME`/`$USERPROFILE` to a throwaway dir BEFORE any production
 *    module is loaded, so config reads/writes never touch the real
 *    `~/.config/rpiv-todo/config.json`. This is why the package imports below
 *    are dynamic and live in `beforeEach`: ES module spec hoists static
 *    imports above the env assignment, which would re-introduce the real-home
 *    leak, and static imports would also seal the module graph against the
 *    `vi.mock` calls that factory-register below.
 *
 * 2. Restore per-test module state: the todo store singleton, the i18n
 *    registration symbol on globalThis, and the config files tests write.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, vi } from "vitest";

const TEST_HOME = mkdtempSync(join(tmpdir(), "rpiv-todo-test-home-"));
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_CONFIG_HOME;
delete process.env.WEB_SEARCH_PROVIDER;

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
	return {
		...actual,
		getSupportedThinkingLevels: vi.fn(() => ["off", "minimal", "low", "medium", "high"]),
	};
});

// `completeSimple` lives on the /compat entrypoint since pi 0.80; production
// code resolves it via loadCompleteSimple(), which prefers /compat, so the
// stub must be registered there for the shim to pick it up.
vi.mock("@earendil-works/pi-ai/compat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai/compat")>();
	return {
		...actual,
		completeSimple: vi.fn(),
		getSupportedThinkingLevels: vi.fn(() => ["off", "minimal", "low", "medium", "high"]),
	};
});

const I18N_SYMBOL = Symbol.for("rpiv-i18n");

beforeEach(async () => {
	delete process.env.PI_CODING_AGENT_DIR;
	delete process.env.XDG_CONFIG_HOME;
	delete process.env.WEB_SEARCH_PROVIDER;

	const todo = await import("../todo.ts");
	todo.__resetState();

	// The i18n SDK records its registration on globalThis so two copies of the
	// extension (parent + child session) share one registry; drop it between
	// tests or the first locale a test applies leaks into every later test.
	delete (globalThis as Record<symbol, unknown>)[I18N_SYMBOL];

	rmSync(join(process.env.HOME!, ".pi", "agent"), { recursive: true, force: true });
	rmSync(join(process.env.HOME!, ".pi", "agent", "settings.json"), { force: true });
	rmSync(join(process.env.HOME!, ".config", "pi", "agent"), { recursive: true, force: true });
	rmSync(join(process.env.HOME!, ".config", "rpiv-todo"), { recursive: true, force: true });
	rmSync(join(process.env.HOME!, ".config", "rpiv-i18n", "locale.json"), { force: true });
});
