import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import registerTodo from "./index.ts";
import { replaceState } from "./state/store.ts";
import { __resetState } from "./todo.ts";

/**
 * Integration coverage for the request-scoped task recitation: register the real
 * extension, drive the real tool, then assert what the `context` handler hands
 * back to the model.
 */
function setup() {
	__resetState();
	const { pi, captured } = createMockPi();
	registerTodo(pi);

	const envelope = captured.events.get("session_start")?.[0];
	const sessionCompact = captured.events.get("session_compact")?.[0];
	const toolExecutionStart = captured.events.get("tool_execution_start")?.[0];
	const contextHandler = captured.events.get("context")?.[0];
	const tool = captured.tools.get("todo");
	if (!envelope) throw new Error("session_start handler not registered");
	if (!sessionCompact) throw new Error("session_compact handler not registered");
	if (!toolExecutionStart) throw new Error("tool_execution_start handler not registered");
	if (!contextHandler) throw new Error("context handler not registered");
	if (!tool) throw new Error("todo tool not registered");

	return {
		sessionStart: envelope,
		sessionCompact,
		toolExecutionStart,
		contextHandler,
		tool: tool as unknown as TodoTool,
	};
}

/**
 * Structural view of the captured `todo` tool: the mock only exposes the
 * implementation seam the tests drive (`execute`), so the generic
 * `ToolDefinition` surface is narrowed once here instead of at every call site.
 */
type TodoTool = {
	execute?: (id: string, params: never, onUpdate: never, signal: never, ctx: never) => unknown;
};

/** Drive the real `todo` tool through a mock ctx. */
async function create(tool: TodoTool, ctx: unknown, params: Record<string, unknown>): Promise<void> {
	await tool.execute?.("tc", params as never, undefined as never, undefined as never, ctx as never);
}

/** Fire N tool executions (any tool name counts toward staleness). */
async function activity(handler: (event: unknown, ctx: unknown) => unknown, ctx: unknown, n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		await handler({ type: "tool_execution_start", toolName: "bash" }, ctx);
	}
}

const EMPTY_MESSAGES = [{ role: "user", content: "hi", timestamp: 1 }];

beforeEach(() => __resetState());
afterEach(() => __resetState());

describe("rpiv-todo — model-facing task recitation", () => {
	it("does not inject anything when the list is empty", async () => {
		const { sessionStart, toolExecutionStart, contextHandler } = setup();
		const ctx = createMockCtx({ sessionId: "s1", hasUI: false });
		await sessionStart({} as never, ctx as never);
		await activity(toolExecutionStart, ctx, 20);

		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();
	});

	it("injects the open list after the default cadence, then appends it to the conversation", async () => {
		const { sessionStart, toolExecutionStart, contextHandler, tool } = setup();
		const ctx = createMockCtx({ sessionId: "s1", hasUI: false });
		await sessionStart({} as never, ctx as never);
		await create(tool, ctx, { action: "create", subject: "wire the reminder" });
		await create(tool, ctx, { action: "update", id: 1, status: "in_progress", activeForm: "wiring it" });

		// Signature recorded, nothing injected yet.
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();

		await activity(toolExecutionStart, ctx, 7);
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();

		await activity(toolExecutionStart, ctx, 1);
		const result = (await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)) as {
			messages: { role: string; content: unknown; timestamp?: number }[];
		};

		expect(result.messages).toHaveLength(EMPTY_MESSAGES.length + 1);
		expect(result.messages[0]).toEqual(EMPTY_MESSAGES[0]);
		const injected = result.messages[1];
		expect(injected?.role).toBe("user");
		expect(String(injected?.content)).toContain("<pi-todo-state>");
		expect(String(injected?.content)).toContain("[in_progress] #1 wire the reminder (wiring it)");
		expect(String(injected?.content)).toContain("8 tool calls since the task list last changed");
	});

	it("does not repeat the reminder on the next request", async () => {
		const { sessionStart, toolExecutionStart, contextHandler, tool } = setup();
		const ctx = createMockCtx({ sessionId: "s1", hasUI: false });
		await sessionStart({} as never, ctx as never);
		await create(tool, ctx, { action: "create", subject: "a" });
		await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx);
		await activity(toolExecutionStart, ctx, 8);
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeDefined();
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();
	});

	it("stops injecting once every task is completed", async () => {
		const { sessionStart, toolExecutionStart, contextHandler, tool } = setup();
		const ctx = createMockCtx({ sessionId: "s1", hasUI: false });
		await sessionStart({} as never, ctx as never);
		await create(tool, ctx, { action: "create", subject: "a" });
		// Record the list signature first: a change alone never injects.
		await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx);
		await activity(toolExecutionStart, ctx, 8);
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeDefined();

		await create(tool, ctx, { action: "update", id: 1, status: "completed" });
		await activity(toolExecutionStart, ctx, 20);
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();
	});

	it("recites once after compaction, even with a zero counter", async () => {
		const { sessionStart, sessionCompact, contextHandler, tool } = setup();
		const ctx = createMockCtx({ sessionId: "s1", hasUI: false });
		await sessionStart({} as never, ctx as never);
		await create(tool, ctx, { action: "create", subject: "survive compaction" });
		// Record the signature; nothing injected yet.
		await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx);

		await sessionCompact({ type: "session_compact" }, ctx as never);

		// The mock branch is empty, so replay after compaction leaves the slot empty;
		// restore the same list (identical signature) to model "compaction kept the
		// state entry".
		replaceState("s1", { tasks: [{ id: 1, subject: "survive compaction", status: "pending" }], nextId: 2 });

		const injected = (await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)) as {
			messages: { content: unknown }[];
		};
		expect(String(injected.messages[1]?.content)).toContain("survive compaction");
		// The forced recitation is consumed: the next request stays quiet.
		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, ctx)).toBeUndefined();
	});

	it("keeps a child session's activity from consuming the parent's reminder", async () => {
		const { sessionStart, toolExecutionStart, contextHandler, tool } = setup();
		const parent = createMockCtx({ sessionId: "parent", hasUI: false });
		const child = createMockCtx({ sessionId: "child", hasUI: false });
		await sessionStart({} as never, parent as never);
		await sessionStart({} as never, child as never);
		await create(tool, parent, { action: "create", subject: "parent work" });
		await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, parent);

		await activity(toolExecutionStart, child, 20);

		expect(await contextHandler({ type: "context", messages: EMPTY_MESSAGES }, parent)).toBeUndefined();
	});
});
