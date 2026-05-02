#!/usr/bin/env node
/**
 * fitclaw-data — CLI bridge for skill data persistence.
 *
 * Provides read/write access to FileSportDataStore namespaces from shell
 * scripts and Python code. Uses FITCLAW_DATA_DIR env var by default.
 *
 * Usage:
 *   fitclaw-data read  --namespace bodybuilding/user_profile
 *   echo '{"name":"John"}' | fitclaw-data write --namespace bodybuilding/user_profile
 *   echo '{"exercise":"squat"}' | fitclaw-data write --namespace bodybuilding/training_log --mode append
 */

import { parseArgs } from "node:util";
import { FileSportDataStore } from "../core/tools/fitness/sport-data-store.js";

interface ParsedOptions {
	namespace?: string;
	"data-dir"?: string;
	mode?: string;
}

function printHelp(): void {
	console.log(`fitclaw-data — Skill data persistence CLI

Usage:
  fitclaw-data read  --namespace <ns> [--data-dir <path>]
  fitclaw-data write --namespace <ns> [--mode replace|append] [--data-dir <path>]

  Data is read from stdin for write commands.
  FITCLAW_DATA_DIR env var is used as default --data-dir.

Subcommands:
  read   Output JSON data for the namespace to stdout
  write  Persist JSON from stdin to the namespace

Options:
  --namespace <ns>   Namespace path (e.g. "bodybuilding/user_profile")
  --data-dir <path>  Data directory (default: $FITCLAW_DATA_DIR)
  --mode <mode>      Write mode: "replace" (default) or "append"
  --help, -h         Show this help`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	const subcommand = args[0];

	if (subcommand !== "read" && subcommand !== "write") {
		console.error(`Usage: fitclaw-data <read|write> --namespace <ns> [--data-dir <path>]`);
		console.error(`       fitclaw-data --help`);
		process.exit(1);
	}

	const { values } = parseArgs({
		args: args.slice(1),
		options: {
			namespace: { type: "string" },
			"data-dir": { type: "string" },
			mode: { type: "string" },
		},
		strict: true,
	}) as { values: ParsedOptions };

	const namespace = values.namespace;
	if (!namespace) {
		console.error("Error: --namespace is required");
		process.exit(1);
	}

	const dataDir = values["data-dir"] || process.env.FITCLAW_DATA_DIR;
	if (!dataDir) {
		console.error("Error: --data-dir is required or set FITCLAW_DATA_DIR env var");
		process.exit(1);
	}

	const store = new FileSportDataStore(dataDir);

	if (subcommand === "read") {
		const data = await store.load(namespace);
		if (data === null) {
			console.log("null");
		} else {
			console.log(JSON.stringify(data, null, 2));
		}
	} else {
		// write
		const mode = (values.mode as string) || "replace";
		if (mode !== "replace" && mode !== "append") {
			console.error(`Error: invalid mode "${mode}". Must be "replace" or "append".`);
			process.exit(1);
		}

		// Read stdin
		let stdin = "";
		for await (const chunk of process.stdin) {
			stdin += String(chunk);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stdin.trim() || "null");
		} catch {
			console.error("Error: stdin is not valid JSON");
			process.exit(1);
		}

		if (mode === "replace") {
			await store.save(namespace, parsed);
		} else {
			const existing = await store.load<unknown[]>(namespace);
			if (existing === null) {
				await store.save(namespace, [parsed]);
			} else if (Array.isArray(existing)) {
				existing.push(parsed);
				await store.save(namespace, existing);
			} else {
				console.error(`Error: cannot append to "${namespace}": existing data is not an array`);
				process.exit(1);
			}
		}

		console.log(JSON.stringify({ success: true, namespace, mode }));
	}
}

main().catch((err) => {
	console.error("Error:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
