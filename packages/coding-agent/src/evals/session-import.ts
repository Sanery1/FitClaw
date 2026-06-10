import { readFileSync } from "node:fs";
import { stringify } from "yaml";

export type CreateSessionEvalTaskDraftOptions = {
	id: string;
	suite?: string;
};

type MessageLike = {
	role?: unknown;
	content?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonl(path: string): unknown[] {
	return readFileSync(path, "utf-8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as unknown);
}

function extractText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((part): part is { type: string; text: string } => {
			return isRecord(part) && part.type === "text" && typeof part.text === "string";
		})
		.map((part) => part.text)
		.join("");
}

function extractMessage(record: unknown): MessageLike | undefined {
	if (!isRecord(record)) {
		return undefined;
	}
	if (record.type === "message" && isRecord(record.message)) {
		return record.message;
	}
	if (isRecord(record.event) && record.event.type === "message_end" && isRecord(record.event.message)) {
		return record.event.message;
	}
	return undefined;
}

function extractLatestPromptAndAnswer(records: unknown[]): { prompt: string; finalAnswer: string } {
	const messages = records
		.map((record) => extractMessage(record))
		.filter((message): message is MessageLike => !!message);
	const userMessages = messages.filter((message) => message.role === "user");
	const assistantMessages = messages.filter((message) => message.role === "assistant");
	const prompt = extractText(userMessages[userMessages.length - 1]?.content);
	const finalAnswer = extractText(assistantMessages[assistantMessages.length - 1]?.content);
	if (!prompt) {
		throw new Error("Could not find a user prompt in the session JSONL.");
	}
	if (!finalAnswer) {
		throw new Error("Could not find an assistant answer in the session JSONL.");
	}
	return { prompt, finalAnswer };
}

export function createSessionEvalTaskDraft(path: string, options: CreateSessionEvalTaskDraftOptions): string {
	const { prompt, finalAnswer } = extractLatestPromptAndAnswer(parseJsonl(path));
	return stringify(
		{
			id: options.id,
			suite: options.suite ?? "session",
			reviewRequired: true,
			sourceSession: path,
			prompt,
			fauxResponses: [{ text: finalAnswer }],
			graders: [
				{
					type: "final_contains",
					text: "HUMAN_REVIEW_REQUIRED",
				},
			],
		},
		{ lineWidth: 0 },
	);
}
