import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalGrader, EvalGraderResult, EvalToolCallRecord } from "./types.js";

export type GradeInput = {
	workspaceDir: string;
	finalAnswer: string;
	toolCalls: EvalToolCallRecord[];
	turnCount: number;
};

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function getJsonPathValue(root: unknown, path: string): unknown {
	if (!path.startsWith("$")) {
		throw new Error(`JSON path must start with "$": ${path}`);
	}
	const tokens = Array.from(path.matchAll(/(?:\.([A-Za-z0-9_-]+))|(?:\[(\d+)\])/g)).map((match) =>
		match[1] === undefined ? Number(match[2]) : match[1],
	);
	return tokens.reduce<unknown>((current, token) => {
		if (typeof token === "number") {
			return Array.isArray(current) ? current[token] : undefined;
		}
		if (typeof current === "object" && current !== null && !Array.isArray(current)) {
			return (current as Record<string, unknown>)[token];
		}
		return undefined;
	}, root);
}

function equalsJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonSubset(actual: unknown, expected: unknown): boolean {
	if (!isRecord(expected)) {
		return equalsJson(actual, expected);
	}
	if (!isRecord(actual)) {
		return false;
	}
	return Object.entries(expected).every(([key, expectedValue]) => isJsonSubset(actual[key], expectedValue));
}

export function gradeEval(grader: EvalGrader, input: GradeInput): EvalGraderResult {
	if (grader.type === "final_contains") {
		const passed = input.finalAnswer.toLowerCase().includes(grader.text.toLowerCase());
		return {
			name: `final_contains:${grader.text}`,
			passed,
			message: passed ? "Final answer contains expected text." : `Final answer did not contain "${grader.text}".`,
		};
	}

	if (grader.type === "final_contains_any") {
		const normalizedAnswer = input.finalAnswer.toLowerCase();
		const passed = grader.texts.some((text) => normalizedAnswer.includes(text.toLowerCase()));
		return {
			name: `final_contains_any:${grader.texts.join("|")}`,
			passed,
			message: passed
				? "Final answer contains one expected text variant."
				: `Final answer did not contain any of ${JSON.stringify(grader.texts)}.`,
		};
	}

	if (grader.type === "final_not_contains") {
		const passed = !input.finalAnswer.toLowerCase().includes(grader.text.toLowerCase());
		return {
			name: `final_not_contains:${grader.text}`,
			passed,
			message: passed ? "Final answer omitted forbidden text." : `Final answer contained "${grader.text}".`,
		};
	}

	if (grader.type === "tool_called") {
		const passed = input.toolCalls.some((call) => call.name === grader.tool);
		return {
			name: `tool_called:${grader.tool}`,
			passed,
			message: passed ? "Expected tool was called." : `Tool "${grader.tool}" was not called.`,
		};
	}

	if (grader.type === "tool_not_called") {
		const passed = !input.toolCalls.some((call) => call.name === grader.tool);
		return {
			name: `tool_not_called:${grader.tool}`,
			passed,
			message: passed ? "Forbidden tool was not called." : `Tool "${grader.tool}" was called.`,
		};
	}

	if (grader.type === "tool_sequence") {
		const actual = input.toolCalls.map((call) => call.name);
		const passed = grader.tools.every((tool, index) => actual[index] === tool);
		return {
			name: `tool_sequence:${grader.tools.join(",")}`,
			passed,
			message: passed
				? "Tool call order matched expected prefix."
				: `Expected tool sequence ${JSON.stringify(grader.tools)}, got ${JSON.stringify(actual)}.`,
		};
	}

	if (grader.type === "tool_args_match") {
		const passed = input.toolCalls.some((call) => call.name === grader.tool && isJsonSubset(call.args, grader.args));
		return {
			name: `tool_args_match:${grader.tool}`,
			passed,
			message: passed
				? "Tool arguments matched expected subset."
				: `No "${grader.tool}" call matched ${JSON.stringify(grader.args)}.`,
		};
	}

	if (grader.type === "file_exists") {
		const filePath = join(input.workspaceDir, grader.file);
		const passed = existsSync(filePath);
		return {
			name: `file_exists:${grader.file}`,
			passed,
			message: passed ? "Expected file exists." : `File "${grader.file}" does not exist.`,
		};
	}

	if (grader.type === "file_not_exists") {
		const filePath = join(input.workspaceDir, grader.file);
		const passed = !existsSync(filePath);
		return {
			name: `file_not_exists:${grader.file}`,
			passed,
			message: passed ? "Unexpected file is absent." : `File "${grader.file}" exists.`,
		};
	}

	if (grader.type === "max_tool_calls") {
		const passed = input.toolCalls.length <= grader.max;
		return {
			name: `max_tool_calls:${grader.max}`,
			passed,
			message: passed
				? "Tool call count is within the limit."
				: `Expected at most ${grader.max} tool calls, got ${input.toolCalls.length}.`,
		};
	}

	if (grader.type === "max_turns") {
		const passed = input.turnCount <= grader.max;
		return {
			name: `max_turns:${grader.max}`,
			passed,
			message: passed
				? "Turn count is within the limit."
				: `Expected at most ${grader.max} turns, got ${input.turnCount}.`,
		};
	}

	const filePath = join(input.workspaceDir, grader.file);
	if (!existsSync(filePath)) {
		return {
			name: `json_path_equals:${grader.file}:${grader.path}`,
			passed: false,
			message: `JSON file "${grader.file}" does not exist.`,
		};
	}
	const actual = getJsonPathValue(readJson(filePath), grader.path);
	const passed = equalsJson(actual, grader.equals);
	return {
		name: `json_path_equals:${grader.file}:${grader.path}`,
		passed,
		message: passed
			? "JSON path matched expected value."
			: `Expected ${JSON.stringify(grader.equals)}, got ${JSON.stringify(actual)}.`,
	};
}

export function gradeEvalTask(graders: EvalGrader[], input: GradeInput): EvalGraderResult[] {
	return graders.map((grader) => gradeEval(grader, input));
}
