import type { GuidanceFields } from "@juicesharp/rpiv-config";
import { loadJsonConfigWithLegacyFallback, validateGuidanceFields } from "@juicesharp/rpiv-config";

interface TodoConfig {
	guidance?: GuidanceFields;
	maxWidgetLines?: number;
	/**
	 * Key spec for the overlay collapse/expand shortcut, in the same format as
	 * pi-coding-agent keybinding ids (`modifier+key`, e.g. `ctrl+shift+t`, `alt+o`).
	 * Defaults to `"ctrl+shift+t"`. Pass `"off"` to disable the collapse shortcut
	 * entirely. Validation happens in `resolveCollapseKey`, not at load.
	 */
	collapseKey?: string;
	/**
	 * Recite the open task list into the request after this many tool executions
	 * without a list change. `0` disables recitation (the pre-existing behaviour).
	 * Read fresh on every request.
	 */
	reminderEveryNToolCalls?: number;
	/**
	 * Maximum number of task lines inlined into one recitation. Read fresh on
	 * every request.
	 */
	reminderMaxStateLines?: number;
}

/** Default content-row budget when the config is missing/invalid — the prior
 *  hardcoded value, preserved as the fallback. */
export const DEFAULT_MAX_WIDGET_LINES = 12;

/** Key spec for the overlay collapse/expand shortcut, e.g. `"ctrl+shift+t"` or `"alt+o"`. */
export type CollapseKeySpec = string;

/** Default collapse/expand key when `collapseKey` is missing/empty/blank/invalid. */
export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+shift+t";

/** Sentinel value for `collapseKey` that disables the collapse shortcut entirely. */
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

export function loadConfig(): TodoConfig {
	return loadJsonConfigWithLegacyFallback<TodoConfig>("rpiv-todo");
}

/** Content-row budget for the overlay, read fresh on every call (per-render —
 *  no `/reload`). Mirrors warp's getHeartbeatMs minus its `=== 0` disabled
 *  sentinel: a non-number or a value below the floor of 3 falls back to the
 *  default; no ceiling. */
export function getMaxWidgetLines(): number {
	const config = loadConfig();
	const lines = config.maxWidgetLines;
	if (typeof lines !== "number" || lines < 3) return DEFAULT_MAX_WIDGET_LINES;
	return lines;
}

/** Default cadence for reciting the open task list into the request. */
export const DEFAULT_REMINDER_EVERY_N_TOOL_CALLS = 8;

/** Sentinel value for `reminderEveryNToolCalls` that disables recitation. */
export const REMINDER_DISABLED = 0;

/** Default cap on task lines inlined into one recitation. */
export const DEFAULT_REMINDER_MAX_STATE_LINES = 12;

/**
 * Cadence for the model-facing task recitation, in tool executions.
 *
 * Mirrors `getMaxWidgetLines()`: read fresh per call (no `/reload`), non-number /
 * non-finite falls back to the default, and `0` is the explicit "off" sentinel.
 * A value of 1 is allowed — reciting after every single call is noisy but a
 * legitimate choice for short, high-stakes sessions.
 */
export function getReminderEveryNToolCalls(): number {
	const value = loadConfig().reminderEveryNToolCalls;
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REMINDER_EVERY_N_TOOL_CALLS;
	if (value === REMINDER_DISABLED) return REMINDER_DISABLED;
	if (value < 1) return DEFAULT_REMINDER_EVERY_N_TOOL_CALLS;
	return Math.floor(value);
}

/** Task-line budget for one recitation. Same fallback policy as `getReminderEveryNToolCalls()`. */
export function getReminderMaxStateLines(): number {
	const value = loadConfig().reminderMaxStateLines;
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_REMINDER_MAX_STATE_LINES;
	if (value < 1) return DEFAULT_REMINDER_MAX_STATE_LINES;
	return Math.floor(value);
}

// Named keys accepted by pi-tui's `matchesKey` (keys.js switch on the parsed base key).
// parseKeyId lowercases the id before matching, so lowercase spellings are canonical.
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

/** Validate a collapse-key spec against pi-tui's KeyId grammar (verbatim port from
 *  rpiv-ask-user-question). Exported for unit tests. */
export function isValidCollapseKeySpec(spec: string): boolean {
	// Mirror pi-tui's KeyId grammar strictly: zero or more distinct modifiers, then a
	// base key that is a single printable character or a named special key. A loose
	// check is not enough — pi-tui's `parseKeyId` takes the LAST `+`-part as the key
	// and ignores unknown parts, so a typo like `ctr+]` would silently match every
	// bare `]` keypress (and the raw terminal listener would consume them globally).
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

/** Resolve the collapse/expand key from config, read fresh on every call
 *  (per-render / per-registration — no `/reload`); mirrors getMaxWidgetLines().
 *  Returns DEFAULT_COLLAPSE_KEY when the field is missing/non-string/empty/blank/
 *  invalid, COLLAPSE_KEY_OFF when set to the sentinel, or the lowercased validated
 *  spec. */
export function resolveCollapseKey(): CollapseKeySpec {
	const config = loadConfig();
	const raw = typeof config.collapseKey === "string" ? config.collapseKey.trim().toLowerCase() : undefined;
	if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

export { validateGuidanceFields };
