import { posix, resolve, win32 } from "node:path";
import type { Skill } from "@fitclaw/runtime";

export interface AllowedCommand {
	readonly executable: string;
	readonly argumentPrefix: readonly string[];
	readonly network: "deny";
}

export function createAllowedCommands(skills: readonly Skill[]): AllowedCommand[] {
	const commands = new Map<string, AllowedCommand>();

	for (const skill of skills) {
		if (skill.permissions?.network !== false) continue;
		for (const permission of skill.permissions.commands?.allow ?? []) {
			const argumentPrefix = permission.args.map((argument, index) => {
				if (index !== 0) return argument;
				if (skill.baseDir.startsWith("/")) return posix.resolve(skill.baseDir, argument.replace(/\\/g, "/"));
				if (win32.isAbsolute(skill.baseDir)) return win32.resolve(skill.baseDir, argument);
				return resolve(skill.baseDir, argument);
			});
			const command: AllowedCommand = { executable: permission.executable, argumentPrefix, network: "deny" };
			commands.set(JSON.stringify(command), command);
		}
	}

	return Array.from(commands.values());
}

export function findAllowedCommand(
	command: string,
	args: readonly string[],
	allowedCommands: readonly AllowedCommand[],
): AllowedCommand | undefined {
	return allowedCommands.find(
		(allowed) =>
			allowed.executable === command &&
			args.length >= allowed.argumentPrefix.length &&
			allowed.argumentPrefix.every((argument, index) => args[index] === argument),
	);
}
