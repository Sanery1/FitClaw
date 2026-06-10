import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAntigravityToken } from "../src/utils/oauth/google-antigravity.js";
import { refreshGoogleCloudToken } from "../src/utils/oauth/google-gemini-cli.js";

const envNames = [
	"FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID",
	"FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET",
	"FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID",
	"FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET",
] as const;

const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function getFormBody(init?: RequestInit): URLSearchParams {
	if (!(init?.body instanceof URLSearchParams)) {
		throw new Error(`Expected URLSearchParams request body, got ${typeof init?.body}`);
	}
	return init.body;
}

afterEach(() => {
	for (const name of envNames) {
		const value = originalEnv[name];
		if (value === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = value;
		}
	}
	vi.unstubAllGlobals();
});

describe("Google OAuth client credentials", () => {
	it("requires Gemini CLI OAuth client credentials from the environment", async () => {
		delete process.env.FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID;
		delete process.env.FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET;

		await expect(refreshGoogleCloudToken("refresh-token", "project-id")).rejects.toThrow(
			"FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID",
		);
	});

	it("uses Gemini CLI OAuth client credentials from the environment", async () => {
		process.env.FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID = "gemini-client-id";
		process.env.FITCLAW_GOOGLE_GEMINI_CLI_OAUTH_CLIENT_SECRET = "gemini-client-secret";

		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
			const body = getFormBody(init);
			expect(body.get("client_id")).toBe("gemini-client-id");
			expect(body.get("client_secret")).toBe("gemini-client-secret");
			return jsonResponse({ access_token: "access-token", expires_in: 3600 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await refreshGoogleCloudToken("refresh-token", "project-id");

		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("requires Antigravity OAuth client credentials from the environment", async () => {
		delete process.env.FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID;
		delete process.env.FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET;

		await expect(refreshAntigravityToken("refresh-token", "project-id")).rejects.toThrow(
			"FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID",
		);
	});

	it("uses Antigravity OAuth client credentials from the environment", async () => {
		process.env.FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_ID = "antigravity-client-id";
		process.env.FITCLAW_GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_SECRET = "antigravity-client-secret";

		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
			const body = getFormBody(init);
			expect(body.get("client_id")).toBe("antigravity-client-id");
			expect(body.get("client_secret")).toBe("antigravity-client-secret");
			return jsonResponse({ access_token: "access-token", expires_in: 3600 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await refreshAntigravityToken("refresh-token", "project-id");

		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
