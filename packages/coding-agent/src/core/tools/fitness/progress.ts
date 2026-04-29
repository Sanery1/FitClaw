import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { PersonalRecord, ProgressiveOverloadEvent } from "../../fitness/schemas.js";

const inMemoryPRs: PersonalRecord[] = [];
const inMemoryProgressiveOverloads: ProgressiveOverloadEvent[] = [];

const getProgressSummarySchema = Type.Object({
	timeframe: Type.Optional(Type.String({ description: "'week', 'month', 'all' (default: 'month')" })),
});

const logProgressiveOverloadSchema = Type.Object({
	exerciseId: Type.String({ description: "Exercise ID" }),
	exerciseName: Type.String({ description: "Exercise name for display" }),
	previousWeight: Type.Number({ description: "Previous working weight in kg" }),
	newWeight: Type.Number({ description: "New working weight in kg" }),
	date: Type.Optional(Type.String({ description: "Date YYYY-MM-DD (default: today)" })),
	reason: Type.String({
		description: "Reason for progression, e.g. 'met_reps_target', 'felt_strong', 'planned_progression'",
	}),
});

export function createGetProgressSummaryTool(): AgentTool<typeof getProgressSummarySchema> {
	return {
		name: "get_progress_summary",
		label: "Get Progress Summary",
		description:
			"Get a summary of training progress including personal records, progressive overload events, and training consistency. Use for periodic reviews and plan adjustments.",
		parameters: getProgressSummarySchema,
		async execute(_toolCallId, params) {
			const timeframe = params.timeframe ?? "month";

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								timeframe,
								personalRecords: inMemoryPRs,
								recencyProgressiveOverloads: inMemoryProgressiveOverloads.slice(-10),
								totalPRs: inMemoryPRs.length,
								totalProgressiveOverloads: inMemoryProgressiveOverloads.length,
							},
							null,
							2,
						),
					},
				],
				details: { prCount: inMemoryPRs.length, poCount: inMemoryProgressiveOverloads.length },
			};
		},
	};
}

export function createLogProgressiveOverloadTool(): AgentTool<typeof logProgressiveOverloadSchema> {
	return {
		name: "log_progressive_overload",
		label: "Log Progressive Overload",
		description:
			"Record a progressive overload event (weight increase) for an exercise. Call when user successfully progresses to a heavier weight after meeting rep targets.",
		parameters: logProgressiveOverloadSchema,
		async execute(_toolCallId, params) {
			const event: ProgressiveOverloadEvent = {
				exerciseId: params.exerciseId,
				exerciseName: params.exerciseName,
				previousWeight: params.previousWeight,
				newWeight: params.newWeight,
				date: params.date ?? new Date().toISOString().slice(0, 10),
				reason: params.reason,
			};

			inMemoryProgressiveOverloads.push(event);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({
							status: "logged",
							exercise: params.exerciseName,
							progress: `${params.previousWeight}kg → ${params.newWeight}kg`,
							increase: `${(params.newWeight - params.previousWeight).toFixed(1)}kg`,
						}),
					},
				],
				details: event,
			};
		},
	};
}
