import { describe, expect, it } from "vitest";
import { createTodoReminder, formatRecitation, isOpenTask, openListSignature } from "./reminder.ts";
import type { Task } from "./tool/types.ts";

function task(partial: Partial<Task> & { id: number }): Task {
	return { subject: `task-${partial.id}`, status: "pending", ...partial };
}

const SETTINGS = { everyNToolCalls: 3, maxStateLines: 12 };

describe("isOpenTask", () => {
	it("treats pending and in_progress as open", () => {
		expect(isOpenTask(task({ id: 1, status: "pending" }))).toBe(true);
		expect(isOpenTask(task({ id: 1, status: "in_progress" }))).toBe(true);
	});
	it("treats completed and deleted as closed", () => {
		expect(isOpenTask(task({ id: 1, status: "completed" }))).toBe(false);
		expect(isOpenTask(task({ id: 1, status: "deleted" }))).toBe(false);
	});
});

describe("openListSignature", () => {
	it("ignores closed tasks so completing one is not treated as a new list", () => {
		const before = [task({ id: 1, status: "in_progress" }), task({ id: 2, status: "completed" })];
		const after = [task({ id: 1, status: "in_progress" }), task({ id: 2, status: "deleted" })];
		expect(openListSignature(before)).toBe(openListSignature(after));
	});
	it("changes when an open task changes status", () => {
		expect(openListSignature([task({ id: 1, status: "pending" })])).not.toBe(
			openListSignature([task({ id: 1, status: "in_progress" })]),
		);
	});
});

describe("formatRecitation", () => {
	it("returns undefined when nothing is open", () => {
		expect(formatRecitation([task({ id: 1, status: "completed" })], 5, 12)).toBeUndefined();
		expect(formatRecitation([], 5, 12)).toBeUndefined();
	});

	it("counts open tasks by status and includes the staleness line", () => {
		const text = formatRecitation(
			[task({ id: 1, status: "in_progress" }), task({ id: 2, status: "pending" })],
			9,
			12,
		);
		expect(text).toContain("<pi-todo-state>");
		expect(text).toContain("9 tool calls since the task list last changed.");
		expect(text).toContain("1 in progress, 1 pending");
		expect(text).toContain("[in_progress] #1 task-1");
		expect(text).toContain("[pending] #2 task-2");
	});

	it("uses singular wording for a single tool call", () => {
		const text = formatRecitation([task({ id: 1 })], 1, 12);
		expect(text).toContain("1 tool call since");
	});

	it("shows activeForm only for in_progress tasks", () => {
		const text = formatRecitation(
			[
				task({ id: 1, status: "in_progress", activeForm: "writing tests" }),
				task({ id: 2, status: "pending", activeForm: "ignored" }),
			],
			2,
			12,
		);
		expect(text).toContain("#1 task-1 (writing tests)");
		expect(text).not.toContain("ignored");
	});

	it("collapses newlines and control characters in subjects", () => {
		const text = formatRecitation([task({ id: 1, subject: "line one\nline two\u0007" })], 2, 12);
		expect(text).toContain("#1 line one line two");
		expect(text).not.toContain("\nline two");
		expect(text).not.toContain("\u0007");
	});

	it("truncates past maxStateLines with a remainder row", () => {
		const tasks = Array.from({ length: 5 }, (_, i) => task({ id: i + 1 }));
		const text = formatRecitation(tasks, 4, 2) ?? "";
		expect(text).toContain("#1");
		expect(text).toContain("#2");
		expect(text).not.toContain("#3 ");
		expect(text).toContain("… 3 more tasks not shown");
	});

	it("uses the singular for a single omitted task", () => {
		const tasks = Array.from({ length: 2 }, (_, i) => task({ id: i + 1 }));
		expect(formatRecitation(tasks, 4, 1)).toContain("… 1 more task not shown");
	});
});

describe("createTodoReminder", () => {
	it("does not inject when the list is empty", () => {
		const reminder = createTodoReminder();
		reminder.noteToolExecution("s");
		expect(reminder.buildMessages("s", [], SETTINGS)).toBeUndefined();
	});

	it("stays quiet below the threshold and fires at it", () => {
		const reminder = createTodoReminder();
		const tasks = [task({ id: 1, status: "in_progress" })];

		// First call after the list appears only records the signature.
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toBeUndefined();

		reminder.noteToolExecution("s");
		reminder.noteToolExecution("s");
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toBeUndefined();

		reminder.noteToolExecution("s");
		const injected = reminder.buildMessages("s", tasks, SETTINGS);
		expect(injected).toHaveLength(1);
		expect(injected?.[0]?.role).toBe("user");
		expect(injected?.[0]?.content).toContain("[in_progress] #1");
		expect(typeof injected?.[0]?.timestamp).toBe("number");
	});

	it("is one-shot: the counter restarts after a recitation", () => {
		const reminder = createTodoReminder();
		const tasks = [task({ id: 1 })];
		reminder.buildMessages("s", tasks, SETTINGS);
		for (let i = 0; i < SETTINGS.everyNToolCalls; i++) reminder.noteToolExecution("s");
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toHaveLength(1);
		// Immediately after firing, no second reminder on the next request.
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toBeUndefined();
	});

	it("resets the counter when the list changes and suppresses that request's reminder", () => {
		const reminder = createTodoReminder();
		reminder.buildMessages("s", [task({ id: 1 })], SETTINGS);
		for (let i = 0; i < SETTINGS.everyNToolCalls; i++) reminder.noteToolExecution("s");

		// A mutation lands (e.g. via codemode): signature changes → no reminder,
		// because the tool result that made the change is the newest message.
		const changed = [task({ id: 1, status: "completed" }), task({ id: 2 })];
		expect(reminder.buildMessages("s", changed, SETTINGS)).toBeUndefined();

		// The counter restarted: still below the threshold.
		reminder.noteToolExecution("s");
		expect(reminder.buildMessages("s", changed, SETTINGS)).toBeUndefined();
	});

	it("recites after compaction even with a zero counter", () => {
		const reminder = createTodoReminder();
		const tasks = [task({ id: 1, status: "in_progress" })];
		reminder.buildMessages("s", tasks, SETTINGS);
		reminder.noteCompaction("s");
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toHaveLength(1);
		// The force flag is consumed.
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toBeUndefined();
	});

	it("never injects when recitation is disabled (everyNToolCalls = 0)", () => {
		const reminder = createTodoReminder();
		const tasks = [task({ id: 1 })];
		const off = { everyNToolCalls: 0, maxStateLines: 12 };
		reminder.buildMessages("s", tasks, off);
		for (let i = 0; i < 50; i++) reminder.noteToolExecution("s");
		expect(reminder.buildMessages("s", tasks, off)).toBeUndefined();
	});

	it("keeps sessions independent", () => {
		const reminder = createTodoReminder();
		const parent = [task({ id: 1 })];
		const child = [task({ id: 9 })];
		reminder.buildMessages("parent", parent, SETTINGS);
		reminder.buildMessages("child", child, SETTINGS);

		for (let i = 0; i < SETTINGS.everyNToolCalls; i++) reminder.noteToolExecution("child");

		expect(reminder.buildMessages("child", child, SETTINGS)).toHaveLength(1);
		// The parent's counter was untouched by the child's activity.
		expect(reminder.buildMessages("parent", parent, SETTINGS)).toBeUndefined();
	});

	it("clear() drops a session's counters", () => {
		const reminder = createTodoReminder();
		const tasks = [task({ id: 1 })];
		reminder.buildMessages("s", tasks, SETTINGS);
		for (let i = 0; i < SETTINGS.everyNToolCalls; i++) reminder.noteToolExecution("s");
		reminder.clear("s");
		// Fresh state: the first call only records the signature again.
		expect(reminder.buildMessages("s", tasks, SETTINGS)).toBeUndefined();
	});
});
