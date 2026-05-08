import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { EvalFauxResponse, EvalFauxToolCall, EvalGrader, EvalTask } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`Eval task field "${field}" must be a non-empty string.`);
	}
	return value;
}

function requireNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Eval task field "${field}" must be a finite number.`);
	}
	return value;
}

function requireStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
		throw new Error(`Eval task field "${field}" must be an array of non-empty strings.`);
	}
	return value;
}

function parseToolCall(value: unknown, index: number): EvalFauxToolCall {
	if (!isRecord(value)) {
		throw new Error(`fauxResponses tool call ${index} must be an object.`);
	}
	const name = requireString(value.name, `fauxResponses.toolCalls[${index}].name`);
	const args = value.args === undefined ? {} : value.args;
	if (!isRecord(args)) {
		throw new Error(`fauxResponses tool call "${name}" args must be an object.`);
	}
	return { name, args };
}

function parseFauxResponse(value: unknown, index: number): EvalFauxResponse {
	if (typeof value === "string") {
		return { text: value };
	}
	if (!isRecord(value)) {
		throw new Error(`fauxResponses[${index}] must be a string or object.`);
	}
	const text = value.text === undefined ? undefined : requireString(value.text, `fauxResponses[${index}].text`);
	const rawToolCalls = value.toolCalls;
	if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
		throw new Error(`fauxResponses[${index}].toolCalls must be an array.`);
	}
	const toolCalls = rawToolCalls?.map((toolCall, toolCallIndex) => parseToolCall(toolCall, toolCallIndex));
	return { text, toolCalls };
}

function parseGrader(value: unknown, index: number): EvalGrader {
	if (!isRecord(value)) {
		throw new Error(`graders[${index}] must be an object.`);
	}
	const type = requireString(value.type, `graders[${index}].type`);
	if (type === "final_contains") {
		return { type, text: requireString(value.text, `graders[${index}].text`) };
	}
	if (type === "tool_called") {
		return { type, tool: requireString(value.tool, `graders[${index}].tool`) };
	}
	if (type === "tool_not_called") {
		return { type, tool: requireString(value.tool, `graders[${index}].tool`) };
	}
	if (type === "tool_sequence") {
		return { type, tools: requireStringArray(value.tools, `graders[${index}].tools`) };
	}
	if (type === "json_path_equals") {
		return {
			type,
			file: requireString(value.file, `graders[${index}].file`),
			path: requireString(value.path, `graders[${index}].path`),
			equals: value.equals,
		};
	}
	if (type === "file_exists") {
		return { type, file: requireString(value.file, `graders[${index}].file`) };
	}
	if (type === "file_not_exists") {
		return { type, file: requireString(value.file, `graders[${index}].file`) };
	}
	if (type === "max_tool_calls") {
		return { type, max: requireNumber(value.max, `graders[${index}].max`) };
	}
	if (type === "max_turns") {
		return { type, max: requireNumber(value.max, `graders[${index}].max`) };
	}
	throw new Error(`Unsupported grader type "${type}".`);
}

export function parseEvalTask(source: string): EvalTask {
	const raw = parse(source) as unknown;
	if (!isRecord(raw)) {
		throw new Error("Eval task must be a YAML object.");
	}
	const rawResponses = raw.fauxResponses;
	if (!Array.isArray(rawResponses) || rawResponses.length === 0) {
		throw new Error('Eval task field "fauxResponses" must be a non-empty array.');
	}
	const rawGraders = raw.graders;
	if (!Array.isArray(rawGraders) || rawGraders.length === 0) {
		throw new Error('Eval task field "graders" must be a non-empty array.');
	}
	return {
		id: requireString(raw.id, "id"),
		suite: requireString(raw.suite, "suite"),
		prompt: requireString(raw.prompt, "prompt"),
		initialData: isRecord(raw.initialData) ? raw.initialData : {},
		fauxResponses: rawResponses.map((response, index) => parseFauxResponse(response, index)),
		graders: rawGraders.map((grader, index) => parseGrader(grader, index)),
	};
}

export function loadEvalTask(path: string): EvalTask {
	return parseEvalTask(readFileSync(path, "utf-8"));
}
