import { basename } from "node:path";
import type { AgentTool } from "@fitclaw/agent-core";
import { Type } from "typebox";
import { createSkillFileResolver } from "../runtime/skill-files.js";
import type { Executor } from "../sandbox.js";
import type { BotContext } from "../types.js";

const MAX_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

const attachSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're sharing (shown to user)" }),
	path: Type.String({ description: "Absolute path inside one of the available Skill directories" }),
	title: Type.Optional(Type.String({ description: "Display title for the file (defaults to filename)" })),
});

export function createAttachTool(
	executor: Executor,
	allowedRoots: readonly string[],
	uploadFile: BotContext["uploadFile"],
): AgentTool<typeof attachSchema> {
	const resolveSkillFile = createSkillFileResolver(executor, allowedRoots);
	const allowedRootList = allowedRoots.join(", ");

	return {
		name: "attach",
		label: "attach",
		description: `Attach an image or file from an available Skill directory: ${allowedRootList}.`,
		parameters: attachSchema,
		execute: async (
			_toolCallId: string,
			{ path, title }: { label: string; path: string; title?: string },
			signal?: AbortSignal,
		) => {
			const resolvedPath = await resolveSkillFile(path, signal);
			const data = await executor.readFile(resolvedPath, { signal, maxBytes: MAX_UPLOAD_FILE_BYTES });
			const fileName = basename(resolvedPath);
			const normalizedTitle = title?.trim() || undefined;

			signal?.throwIfAborted();
			await uploadFile({ data, fileName, title: normalizedTitle });

			return {
				content: [{ type: "text" as const, text: `Attached file: ${normalizedTitle || fileName}` }],
				details: undefined,
			};
		},
	};
}
