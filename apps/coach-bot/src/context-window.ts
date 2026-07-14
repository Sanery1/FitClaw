import type { AgentMessage } from "@fitclaw/agent-core";

export interface MomContextWindowOptions {
	maxMessages: number;
	maxSerializedChars: number;
}

export interface MomContextWindowResult {
	messages: AgentMessage[];
	originalCount: number;
	retainedCount: number;
	wasTrimmed: boolean;
}

const DEFAULT_MAX_MESSAGES = 80;
const DEFAULT_MAX_SERIALIZED_CHARS = 120_000;

interface MessageTurn {
	start: number;
	end: number;
}

export function getMomContextWindowOptions(env: NodeJS.ProcessEnv = process.env): MomContextWindowOptions {
	return {
		maxMessages: readPositiveInteger(env.MOM_CONTEXT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
		maxSerializedChars: readPositiveInteger(env.MOM_CONTEXT_MAX_CHARS, DEFAULT_MAX_SERIALIZED_CHARS),
	};
}

export function windowMomContext(
	messages: readonly AgentMessage[],
	options: MomContextWindowOptions,
): MomContextWindowResult {
	if (messages.length === 0) {
		return {
			messages: [],
			originalCount: 0,
			retainedCount: 0,
			wasTrimmed: false,
		};
	}

	const turns = splitIntoTurns(messages);
	let retainedStart = messages.length;
	let retainedMessages = 0;
	let retainedChars = 0;

	for (let index = turns.length - 1; index >= 0; index--) {
		const turn = turns[index];
		const turnMessages = messages.slice(turn.start, turn.end);
		const nextMessageCount = retainedMessages + turnMessages.length;
		const nextCharCount = retainedChars + estimateSerializedChars(turnMessages);

		if (
			retainedMessages > 0 &&
			(nextMessageCount > options.maxMessages || nextCharCount > options.maxSerializedChars)
		) {
			break;
		}

		retainedStart = turn.start;
		retainedMessages = nextMessageCount;
		retainedChars = nextCharCount;
	}

	const retained = trimOversizedNewestTurn(messages.slice(retainedStart), options);

	return {
		messages: retained,
		originalCount: messages.length,
		retainedCount: retained.length,
		wasTrimmed: retained.length !== messages.length,
	};
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function splitIntoTurns(messages: readonly AgentMessage[]): MessageTurn[] {
	const turns: MessageTurn[] = [];
	let start = 0;

	for (let index = 1; index < messages.length; index++) {
		if (messages[index].role === "user") {
			turns.push({ start, end: index });
			start = index;
		}
	}

	turns.push({ start, end: messages.length });
	return turns;
}

function trimOversizedNewestTurn(messages: AgentMessage[], options: MomContextWindowOptions): AgentMessage[] {
	if (messages.length <= options.maxMessages && estimateSerializedChars(messages) <= options.maxSerializedChars) {
		return messages.slice();
	}

	let start = messages.length;
	let retainedChars = 0;

	for (let index = messages.length - 1; index >= 0; index--) {
		const messageChars = estimateSerializedChars([messages[index]]);
		const nextCount = messages.length - index;
		const nextChars = retainedChars + messageChars;

		if (start < messages.length && (nextCount > options.maxMessages || nextChars > options.maxSerializedChars)) {
			break;
		}

		start = index;
		retainedChars = nextChars;
	}

	return messages.slice(start);
}

function estimateSerializedChars(messages: readonly AgentMessage[]): number {
	let chars = 0;
	for (const message of messages) {
		chars += JSON.stringify(message)?.length ?? 0;
	}
	return chars;
}
