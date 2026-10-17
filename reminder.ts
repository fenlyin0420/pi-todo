/**
 * Task-state recitation — keeps the open task list inside the model's attention
 * window during long sessions.
 *
 * Why this exists: the `todo` tool's own results are one-line summaries
 * (`Updated #2 (pending → in_progress)`), and the overlay is a TUI widget the
 * model never reads. Nothing re-states the list, so once those tool results sink
 * into the middle of a long transcript the model has no way to know a task is
 * still open. Sessions routinely drift after a few dozen tool calls.
 *
 * The fix is the one every long-horizon harness converged on: re-state the list
 * into the *request* (not the transcript) on a bounded cadence. Design choices:
 *
 * - **State, not just a nudge.** A "remember to use the tool" reminder without
 *   the list cannot correct the model; the list is the signal.
 * - **Bounded cadence.** Firing on every request is noise during tool
 *   continuations (a known failure mode; same conclusion as codex#19749).
 * - **Reset on state change, not on tool use.** The counter clears when the list
 *   itself changes, so a mutation made through another tool (`ctx.executeTool`,
 *   e.g. codemode) is recognized too — that path never emits a `todo` tool event.
 * - **Request-scoped.** The injected message is not persisted: `context` is a
 *   request-time transform, so the reminder cannot accumulate in the transcript.
 * - **Post-compaction re-arm.** Compaction drops the earlier tool results, so a
 *   forced recitation follows it even though the list did not change.
 *
 * The injected text is harness state, addressed to the model. It is deliberately
 * not phrased as a hidden instruction ("never mention this"), which is
 * indistinguishable from prompt injection; the model may reference it freely.
 */

import { sanitizeTerminalText } from "./tool/sanitize.ts";
import type { Task } from "./tool/types.ts";

/** Maximum characters of a single subject line kept in the recitation. */
const MAX_SUBJECT_CHARS = 120;

/** Per-session staleness counters. */
interface SessionReminderState {
	/** Tool executions observed since the task list last changed. */
	callsSinceChange: number;
	/** Fingerprint of the open list at the last reset. */
	signature: string;
	/** Set after a compaction: force one recitation on the next request. */
	forceNext: boolean;
}

/** Cadence settings, resolved by the caller from config on every request. */
export interface ReminderSettings {
	/** Recite after this many tool executions without a list change. 0 disables. */
	everyNToolCalls: number;
	/** Cap on task lines included in one recitation. */
	maxStateLines: number;
}

function freshState(): SessionReminderState {
	return { callsSinceChange: 0, signature: "", forceNext: false };
}

/**
 * Open tasks are the ones worth reciting: `completed` needs no action and
 * `deleted` is a tombstone.
 */
export function isOpenTask(task: Task): boolean {
	return task.status === "pending" || task.status === "in_progress";
}

/**
 * Fingerprint of the open list. Order-independent on purpose: a reorder is not a
 * meaningful change for the model, and `todo` never reorders anyway.
 */
export function openListSignature(tasks: readonly Task[]): string {
	return tasks
		.filter(isOpenTask)
		.map((task) => `${task.id}:${task.status}:${task.subject}`)
		.sort()
		.join("\u0001");
}

/** Collapse whitespace so a multi-line subject cannot break the block layout. */
function oneLine(text: string): string {
	return sanitizeTerminalText(text).replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT_CHARS);
}

/**
 * Render the recitation block, or `undefined` when there is nothing worth
 * saying (no open tasks).
 *
 * @param tasks — the session's live task list
 * @param callsSinceChange — tool executions since the list last changed
 * @param maxStateLines — cap on how many task lines are inlined
 */
export function formatRecitation(
	tasks: readonly Task[],
	callsSinceChange: number,
	maxStateLines: number,
): string | undefined {
	const open = tasks.filter(isOpenTask);
	if (open.length === 0) return undefined;

	const inProgress = open.filter((task) => task.status === "in_progress").length;
	const pending = open.length - inProgress;

	const shown = open.slice(0, Math.max(1, maxStateLines));
	const lines = shown.map((task) => {
		const form = task.status === "in_progress" && task.activeForm ? ` (${oneLine(task.activeForm)})` : "";
		return `[${task.status}] #${task.id} ${oneLine(task.subject)}${form}`;
	});
	const omitted = open.length - shown.length;
	if (omitted > 0) lines.push(`… ${omitted} more task${omitted === 1 ? "" : "s"} not shown`);

	const counts = `${inProgress} in progress, ${pending} pending`;
	const header =
		callsSinceChange > 0
			? `${callsSinceChange} tool call${callsSinceChange === 1 ? "" : "s"} since the task list last changed.`
			: "The task list has open items.";

	return [
		"<pi-todo-state>",
		header,
		`Current task list (${counts}):`,
		...lines,
		"</pi-todo-state>",
		"Keep the list accurate: mark the task you are starting as in_progress and complete it when its",
		"result is verified, not when the code is written. One task in_progress at a time.",
	].join("\n");
}

/**
 * Staleness tracker + injection builder. One instance per registered extension;
 * state is keyed by session id so a child/subagent session can never advance or
 * consume the parent's counter.
 */
export function createTodoReminder() {
	const sessions = new Map<string, SessionReminderState>();

	function stateFor(sessionId: string): SessionReminderState {
		let state = sessions.get(sessionId);
		if (!state) {
			state = freshState();
			sessions.set(sessionId, state);
		}
		return state;
	}

	return {
		/** Count one tool execution. Any tool counts — see the module comment. */
		noteToolExecution(sessionId: string): void {
			const state = stateFor(sessionId);
			// Saturate: the exact number past the threshold does not matter, and an
			// unbounded counter on a forgotten session is needless state.
			if (state.callsSinceChange < Number.MAX_SAFE_INTEGER) state.callsSinceChange += 1;
		},

		/** Compaction dropped the earlier tool results: recite once unconditionally. */
		noteCompaction(sessionId: string): void {
			stateFor(sessionId).forceNext = true;
		},

		/** Drop a session's counters (session_shutdown). */
		clear(sessionId: string): void {
			sessions.delete(sessionId);
		},

		/** Test seam. */
		__reset(): void {
			sessions.clear();
		},

		/**
		 * Build the request-scoped reminder, or `undefined` when nothing should be
		 * injected. Consumes the staleness counter when it returns a message, so the
		 * reminder fires once per interval rather than on every request.
		 *
		 * A list change resets the counter and suppresses this request's recitation:
		 * the `todo` tool result that caused the change is already the newest message.
		 */
		buildMessages(
			sessionId: string,
			tasks: readonly Task[],
			settings: ReminderSettings,
		): { role: "user"; content: string; timestamp: number }[] | undefined {
			const state = stateFor(sessionId);
			const signature = openListSignature(tasks);

			if (signature !== state.signature) {
				state.signature = signature;
				state.callsSinceChange = 0;
				state.forceNext = false;
				return undefined;
			}

			const maxStateLines = Math.max(1, settings.maxStateLines);
			const text = formatRecitation(tasks, state.callsSinceChange, maxStateLines);
			if (!text) {
				// Nothing open: keep the counter from growing forever while idle.
				state.callsSinceChange = 0;
				return undefined;
			}

			const due =
				state.forceNext || (settings.everyNToolCalls > 0 && state.callsSinceChange >= settings.everyNToolCalls);
			if (!due) return undefined;

			state.forceNext = false;
			state.callsSinceChange = 0;
			// Verification aid: set PI_TODO_REMINDER_DEBUG=1 to see recitations on stderr.
			if (process.env.PI_TODO_REMINDER_DEBUG === "1") {
				process.stderr.write(`[rpiv-todo] recitation injected (session ${sessionId || "?"})\n`);
			}
			return [{ role: "user", content: text, timestamp: Date.now() }];
		},
	};
}

export type TodoReminder = ReturnType<typeof createTodoReminder>;
