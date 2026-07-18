import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { KnowledgeError } from "@fitclaw/runtime";
import type { PageRenderer } from "./types.js";

const execFileAsync = promisify(execFile);

export class PopplerPageRenderer implements PageRenderer {
	constructor(private readonly cacheRoot: string) {}

	async render(input: {
		sourceId: string;
		pdfPath: string;
		pdfPage: number;
	}): Promise<{ data: string; mimeType: "image/png" }> {
		const sourceCache = join(this.cacheRoot, input.sourceId);
		const outputPrefix = join(sourceCache, `pdf-${input.pdfPage.toString().padStart(4, "0")}-180dpi`);
		const outputPath = `${outputPrefix}.png`;
		try {
			const cached = await readFile(outputPath);
			return { data: cached.toString("base64"), mimeType: "image/png" };
		} catch {}

		await mkdir(sourceCache, { recursive: true });
		try {
			await execFileAsync(
				"pdftoppm",
				[
					"-f",
					String(input.pdfPage),
					"-l",
					String(input.pdfPage),
					"-singlefile",
					"-r",
					"180",
					"-png",
					input.pdfPath,
					outputPrefix,
				],
				{ windowsHide: true, timeout: 30_000 },
			);
			const rendered = await readFile(outputPath);
			return { data: rendered.toString("base64"), mimeType: "image/png" };
		} catch (error) {
			const message =
				error instanceof Error && "code" in error && error.code === "ENOENT"
					? "Poppler pdftoppm is not installed"
					: "The requested PDF page could not be rendered";
			throw new KnowledgeError("render_unavailable", message);
		}
	}
}
