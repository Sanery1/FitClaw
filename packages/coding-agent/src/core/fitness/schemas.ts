// ── CustomMessageEntry（进 LLM 上下文）──

/** customType: "fitclaw/workout" */
export interface WorkoutRecord {
	date: string;
	exercises: Array<{
		exerciseId: string;
		exerciseName: string;
		sets: Array<{ reps: number; weight: number; rpe?: number }>;
	}>;
	duration?: number;
	notes?: string;
}

/** customType: "fitclaw/body_metrics" */
export interface BodyMetrics {
	date: string;
	weight?: number;
	bodyFat?: number;
	measurements?: Record<string, number>;
}

/** customType: "fitclaw/personal_record" */
export interface PersonalRecord {
	exerciseId: string;
	exerciseName: string;
	type: "weight" | "reps" | "volume";
	value: number;
	date: string;
}

// ── CustomEntry（不进 LLM 上下文，纯状态）──

/** customType: "fitclaw/progressive_overload" */
export interface ProgressiveOverloadEvent {
	exerciseId: string;
	exerciseName: string;
	previousWeight: number;
	newWeight: number;
	date: string;
	reason: string;
}

// ── 训练计划（独立文件存储）──

export interface TrainingPlan {
	createdAt: string;
	updatedAt: string;
	goal: string;
	experienceLevel: "beginner" | "intermediate" | "advanced";
	splitType: "ppl" | "full_body" | "upper_lower" | "bro_split" | "custom";
	daysPerWeek: number;
	availableEquipment: string[];
	injuriesOrLimitations?: string;
	weeks: PlanWeek[];
}

export interface PlanWeek {
	weekNumber: number;
	days: PlanDay[];
}

export interface PlanDay {
	dayOfWeek: number;
	focus: string;
	exercises: PlanExercise[];
	notes?: string;
}

export interface PlanExercise {
	exerciseId: string;
	exerciseName: string;
	sets: number;
	repsRange: string;
	restSeconds: number;
	notes?: string;
	progressionType?: "double_progression" | "linear" | "wave";
}

// ── 动作数据库 ──

export interface Exercise {
	id: string;
	name: string;
	nameZh?: string;
	primaryMuscle: string;
	secondaryMuscles: string[];
	equipment: string[];
	difficulty: "beginner" | "intermediate" | "advanced";
	category: "compound" | "isolation";
	description: string;
	instructions: string[];
	tips: string[];
	cautions?: string[];
	variations: string[];
	gifUrl?: string;
}

// ── 健身用户画像（用于 compaction 摘要）──

export interface FitnessProfile {
	experienceLevel?: "beginner" | "intermediate" | "advanced";
	trainingGoal?: string;
	availableEquipment?: string[];
	injuriesOrLimitations?: string;
	daysPerWeek?: number;
	currentSplit?: string;
	personalRecords?: PersonalRecord[];
	recentWorkouts?: Array<{ date: string; exerciseCount: number; duration?: number }>;
	latestBodyMetrics?: BodyMetrics;
	totalWorkouts?: number;
}
