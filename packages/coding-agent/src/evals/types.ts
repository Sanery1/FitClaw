import type { AgentEvent } from "@fitclaw/agent-core";

export type EvalTask = {
	id: string;
	suite: string;
	prompt: string;
	initialData: Record<string, unknown>;
	fauxResponses: EvalFauxResponse[];
	graders: EvalGrader[];
};

export type EvalFauxResponse = {
	text?: string;
	toolCalls?: EvalFauxToolCall[];
};

export type EvalFauxToolCall = {
	name: string;
	args: Record<string, unknown>;
};

export type EvalGrader =
	| {
			type: "final_contains";
			text: string;
	  }
	| {
			type: "tool_called";
			tool: string;
	  }
	| {
			type: "tool_not_called";
			tool: string;
	  }
	| {
			type: "tool_sequence";
			tools: string[];
	  }
	| {
			type: "json_path_equals";
			file: string;
			path: string;
			equals: unknown;
	  }
	| {
			type: "file_exists";
			file: string;
	  }
	| {
			type: "file_not_exists";
			file: string;
	  }
	| {
			type: "max_tool_calls";
			max: number;
	  }
	| {
			type: "max_turns";
			max: number;
	  };

export type EvalToolCallRecord = {
	name: string;
	args: Record<string, unknown>;
};

export type EvalGraderResult = {
	name: string;
	passed: boolean;
	message: string;
};

export type EvalTrialResult = {
	taskId: string;
	suite: string;
	passed: boolean;
	finalAnswer: string;
	toolCalls: EvalToolCallRecord[];
	graderResults: EvalGraderResult[];
	transcriptPath: string;
	metrics: {
		turnCount: number;
		toolCallCount: number;
		durationMs: number;
	};
};

export type EvalTranscriptEvent = {
	timestamp: string;
	event: AgentEvent;
};
