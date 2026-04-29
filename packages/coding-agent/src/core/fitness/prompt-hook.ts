import type { FitnessProfile, TrainingPlan } from "./schemas.js";

/**
 * Build fitness context string to append to the system prompt.
 * Injects user profile, current plan summary, and available equipment.
 */
export function buildFitnessPromptHook(profile: FitnessProfile | null, plan: TrainingPlan | null): string | null {
	if (!profile && !plan) return null;

	const lines: string[] = ["\n# Fitness Coach Context"];

	if (profile) {
		lines.push("\n## User Profile");
		if (profile.experienceLevel) lines.push(`- Level: ${profile.experienceLevel}`);
		if (profile.trainingGoal) lines.push(`- Goal: ${profile.trainingGoal}`);
		if (profile.daysPerWeek) lines.push(`- Training days/week: ${profile.daysPerWeek}`);
		if (profile.currentSplit) lines.push(`- Current split: ${profile.currentSplit}`);
		if (profile.availableEquipment?.length) {
			lines.push(`- Available equipment: ${profile.availableEquipment.join(", ")}`);
		}
		if (profile.injuriesOrLimitations) {
			lines.push(`- Injuries/limitations: ${profile.injuriesOrLimitations}`);
		}
		if (profile.totalWorkouts) lines.push(`- Total workouts logged: ${profile.totalWorkouts}`);
	}

	if (plan) {
		lines.push("\n## Active Training Plan");
		lines.push(`- Goal: ${plan.goal}`);
		lines.push(`- Split: ${plan.splitType} (${plan.daysPerWeek} days/week)`);
		lines.push(`- Available equipment: ${plan.availableEquipment.join(", ")}`);
		if (plan.injuriesOrLimitations) {
			lines.push(`- Injuries/limitations: ${plan.injuriesOrLimitations}`);
		}

		const today = new Date().getDay() || 7;
		const todayDay = plan.weeks.flatMap((w) => w.days).find((d) => d.dayOfWeek === today);
		if (todayDay) {
			lines.push(`- Today's workout (day ${today}): ${todayDay.focus}`);
			lines.push(`  Exercises: ${todayDay.exercises.map((e) => e.exerciseName).join(", ")}`);
		}
	}

	return lines.join("\n");
}
