/**
 * Utilities for formatting keybinding hints in the UI.
 */

import { getKeybindings, type Keybinding, type KeyId } from "@fitclaw/tui";
import { theme } from "../theme/theme.js";

function formatKeys(keys: KeyId[]): string {
	if (keys.length === 0) return "";
	if (keys.length === 1) return keys[0]!;
	return keys.join("/");
}

export function formatKeyDisplay(key: string): string {
	return key
		.split("/")
		.map((binding) =>
			binding
				.split("+")
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join("/");
}

export function keyText(keybinding: Keybinding): string {
	return formatKeys(getKeybindings().getKeys(keybinding));
}

export function keyDisplay(keybinding: Keybinding): string {
	return formatKeyDisplay(keyText(keybinding));
}

export function keyHint(keybinding: Keybinding, description: string): string {
	return theme.fg("dim", keyText(keybinding)) + theme.fg("muted", ` ${description}`);
}

export function rawKeyHint(key: string, description: string): string {
	return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}
