import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import type { BodyMetrics } from "../../fitness/schemas.js";
import type { SportDataStore } from "./sport-data-store.js";
import { emptyFitnessData, type FitnessData } from "./store.js";

const logBodyMetricsSchema = Type.Object({
	date: Type.Optional(Type.String({ description: "Measurement date YYYY-MM-DD (default: today)" })),
	weight: Type.Optional(Type.Number({ description: "Body weight in kg" })),
	bodyFat: Type.Optional(Type.Number({ description: "Body fat percentage" })),
	measurements: Type.Optional(
		Type.Record(Type.String(), Type.Number(), {
			description: 'Body measurements in cm, e.g. { "chest": 100, "waist": 80, "arm": 35 }',
		}),
	),
});

const getBodyMetricsHistorySchema = Type.Object({
	limit: Type.Optional(Type.Number({ description: "Max entries (default 30)" })),
});

async function loadData(store: SportDataStore): Promise<FitnessData> {
	return (await store.load<FitnessData>("fitness")) ?? emptyFitnessData();
}

export function createLogBodyMetricsTool(store?: SportDataStore): AgentTool<typeof logBodyMetricsSchema> {
	return {
		name: "log_body_metrics",
		label: "Log Body Metrics",
		description:
			"Record body measurements: weight, body fat percentage, and circumference measurements (chest, waist, arms, thighs, etc.). Track body composition changes over time.",
		parameters: logBodyMetricsSchema,
		async execute(_toolCallId, params) {
			const record: BodyMetrics = {
				date: params.date ?? new Date().toISOString().slice(0, 10),
				weight: params.weight,
				bodyFat: params.bodyFat,
				measurements: params.measurements,
			};

			if (store) {
				const data = await loadData(store);
				data.metrics.push(record);
				await store.save("fitness", data);
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ status: "logged", ...record }),
					},
				],
				details: record,
			};
		},
	};
}

export function createGetBodyMetricsHistoryTool(store?: SportDataStore): AgentTool<typeof getBodyMetricsHistorySchema> {
	return {
		name: "get_body_metrics_history",
		label: "Get Body Metrics History",
		description:
			"Retrieve body measurement history. Use to track weight trends, body fat changes, and measurement progress over time.",
		parameters: getBodyMetricsHistorySchema,
		async execute(_toolCallId, params) {
			const metrics = store ? (await loadData(store)).metrics : [];
			const sorted = [...metrics].sort((a, b) => b.date.localeCompare(a.date));
			const limit = params.limit ?? 30;
			const sliced = sorted.slice(0, limit);

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ count: sliced.length, metrics: sliced }, null, 2),
					},
				],
				details: { count: sliced.length },
			};
		},
	};
}
