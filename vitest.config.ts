import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			// Vendored fixture package — see test-utils/index.ts. Keeping the
			// `@juicesharp/rpiv-test-utils` specifier means the test files stay
			// byte-identical to rpiv-mono, so upstream sync is a plain copy.
			"@juicesharp/rpiv-test-utils": new URL("./test-utils/index.ts", import.meta.url).pathname,
		},
	},
	test: {
		server: {
			deps: {
				// Both are published as TypeScript sources (`exports` → `./index.ts`),
				// which Node cannot load directly. Inlining makes Vite transform them
				// instead of externalizing to node's native loader.
				inline: ["@juicesharp/rpiv-config", "@juicesharp/rpiv-i18n"],
			},
		},
		include: ["**/*.test.ts"],
		exclude: ["node_modules/**", "test-utils/**"],
		setupFiles: ["./test/setup.ts"],
		// setup.ts performs dynamic `await import(...)` calls inside beforeEach
		// (deliberately — see its header comment). Cold-cache resolution on the
		// first test of a worker can exceed vitest's default 10s hookTimeout.
		hookTimeout: 30_000,
		// Subprocess-heavy tests beat vitest's 5s default under load.
		testTimeout: 15_000,
		maxWorkers: Math.max(1, Math.floor(availableParallelism() * 0.6)),
		unstubGlobals: true,
		clearMocks: true,
		restoreMocks: true,
		passWithNoTests: true,
	},
});
