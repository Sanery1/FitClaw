import type { AgentEvent } from "@fitclaw/agent-core";

export type EvalTask = {
	id: string;
	suite: string;
	prompt: string;
	systemPrompt?: string;
	initialData: Record<string, unknown>;
	knowledge?: EvalKnowledgeFixture;
	fauxResponses?: EvalFauxResponse[];
	graders: EvalGrader[];
};

export type EvalKnowledgeFixture = {
	allowedCollections: string[];
	pages: EvalKnowledgePage[];
};

export type EvalKnowledgePage = {
	pageId: string;
	sourceId: string;
	title: string;
	edition: string;
	collection: string;
	chapter: string | null;
	bookPage: number | null;
	pdfPage: number;
	text: string;
	keywords: string[];
	needsVisual: boolean;
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
			type: "final_contains_any";
			texts: string[];
	  }
	| {
			type: "final_not_contains";
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
			type: "tool_args_match";
			tool: string;
			args: Record<string, unknown>;
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
	  }
	| {
			type: "retrieved_page_ids";
			pageIds: string[];
			tool?: string;
	  }
	| {
			type: "citation_present";
			title: string;
			edition: string;
			bookPage: number | null;
			pdfPage: number;
	  }
	| {
			type: "citation_absent";
	  };

export type EvalToolCallRecord = {
	name: string;
	args: Record<string, unknown>;
	pageIds: string[];
	isError: boolean;
};

export type EvalGraderResult = {
	name: string;
	passed: boolean;
	message: string;
};

export type EvalTrialResult = {
	taskId: string;
	suite: string;
	trialIndex: number;
	modelId: string;
	passed: boolean;
	errorMessage?: string;
	finalAnswer: string;
	toolCalls: EvalToolCallRecord[];
	graderResults: EvalGraderResult[];
	transcriptPath: string;
	metrics: {
		turnCount: number;
		toolCallCount: number;
		durationMs: number;
		inputTokens: number;
		outputTokens: number;
		cost: number;
	};
};

export type EvalTranscriptEvent = {
	timestamp: string;
	event: AgentEvent;
};

export type EvalRateMetric = {
	passed: number;
	total: number;
	rate: number;
};

export type EvalSummaryMetrics = {
	totalTasks: number;
	totalTrials: number;
	runsPerTask: number;
	passAt1: EvalRateMetric;
	passAtK: EvalRateMetric;
	passAllK: EvalRateMetric;
	trialPassRate: EvalRateMetric;
	graderPassRate: EvalRateMetric;
	averageToolCalls: number;
	averageTurns: number;
	averageDurationMs: number;
	averageInputTokens: number;
	averageOutputTokens: number;
	averageCost: number;
};
