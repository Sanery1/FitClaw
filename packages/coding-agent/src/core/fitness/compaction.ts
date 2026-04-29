import type { BodyMetrics, FitnessProfile, PersonalRecord, WorkoutRecord } from "./schemas.js";

/**
 * Extract fitness profile from session data for compaction summary injection.
 */
export function extractFitnessProfile(
	entries: Array<{ type: string; customType?: string; data?: unknown }>,
): FitnessProfile {
	const profile: FitnessProfile = {};
	const workouts: WorkoutRecord[] = [];
	const bodyMetrics: BodyMetrics[] = [];

	for (const entry of entries) {
		if (entry.type === "custom_message" && entry.customType === "fitclaw/workout" && entry.data) {
			workouts.push(entry.data as WorkoutRecord);
		}
		if (entry.type === "custom_message" && entry.customType === "fitclaw/body_metrics" && entry.data) {
			bodyMetrics.push(entry.data as BodyMetrics);
		}
		if (entry.type === "custom_message" && entry.customType === "fitclaw/personal_record" && entry.data) {
			if (!profile.personalRecords) profile.personalRecords = [];
			profile.personalRecords.push(entry.data as PersonalRecord);
		}
	}

	profile.totalWorkouts = workouts.length;
	if (workouts.length > 0) {
		profile.recentWorkouts = workouts.slice(-5).map((w) => ({
			date: w.date,
			exerciseCount: w.exercises.length,
			duration: w.duration,
		}));
	}

	if (bodyMetrics.length > 0) {
		profile.latestBodyMetrics = bodyMetrics.reduce((latest, curr) => (curr.date > latest.date ? curr : latest));
	}

	return profile;
}

/**
 * Generate the fitness data extraction instruction for the compaction LLM prompt.
 */
export const FITNESS_COMPACTION_INSTRUCTION = `
## Fitness Data
If the conversation includes fitness coaching (workouts logged, body metrics recorded, training plans discussed, personal records set), extract the following into the "fitnessProfile" field of the summary JSON:
- experienceLevel: user's training experience level
- trainingGoal: what they're training for
- availableEquipment: list of equipment they have access to
- injuriesOrLimitations: any mentioned injuries or physical limits
- daysPerWeek: how many days they train per week
- currentSplit: their training split type (ppl, full_body, etc.)
- personalRecords: array of notable PRs achieved
- recentWorkouts: last 5 workouts (date, exerciseCount, duration)
- latestBodyMetrics: most recent body weight and measurements
`;
