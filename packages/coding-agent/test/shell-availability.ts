import { getShellConfig } from "@fitclaw/runtime";

export const HAS_LOCAL_SHELL = (() => {
	try {
		getShellConfig();
		return true;
	} catch {
		return false;
	}
})();
