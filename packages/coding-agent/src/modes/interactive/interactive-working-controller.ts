import { type Container, Loader, type LoaderIndicatorOptions, type TUI } from "@fitclaw/tui";
import { keyText } from "./components/keybinding-hints.js";
import { theme } from "./theme/theme.js";

export interface InteractiveWorkingControllerOptions {
	ui: TUI;
	statusContainer: Container;
	isStreaming: () => boolean;
}

export class InteractiveWorkingController {
	private static readonly DEFAULT_MESSAGE = "Working...";

	private loader: Loader | undefined;
	private message: string | undefined;
	private isVisible = true;
	private indicatorOptions: LoaderIndicatorOptions | undefined;

	constructor(private readonly options: InteractiveWorkingControllerOptions) {}

	startAgentActivity(): void {
		this.stop();
		if (!this.isVisible) return;

		this.loader = this.createLoader();
		this.options.statusContainer.addChild(this.loader);
	}

	stopAgentActivity(): void {
		if (!this.loader) return;
		this.loader.stop();
		this.loader = undefined;
		this.options.statusContainer.clear();
	}

	stop(): void {
		this.loader?.stop();
		this.loader = undefined;
		this.options.statusContainer.clear();
	}

	dispose(): void {
		this.loader?.stop();
		this.loader = undefined;
	}

	setMessage(message: string | undefined): void {
		this.message = message;
		this.loader?.setMessage(message ?? InteractiveWorkingController.DEFAULT_MESSAGE);
	}

	setVisible(visible: boolean): void {
		this.isVisible = visible;
		if (!visible) {
			this.stop();
			this.options.ui.requestRender();
			return;
		}

		if (this.options.isStreaming() && !this.loader) {
			this.options.statusContainer.clear();
			this.loader = this.createLoader();
			this.options.statusContainer.addChild(this.loader);
		}
		this.options.ui.requestRender();
	}

	setIndicator(options?: LoaderIndicatorOptions): void {
		this.indicatorOptions = options;
		this.loader?.setIndicator(options);
		this.options.ui.requestRender();
	}

	reset(): void {
		this.message = undefined;
		this.isVisible = true;
		this.setIndicator();
		this.loader?.setMessage(
			`${InteractiveWorkingController.DEFAULT_MESSAGE} (${keyText("app.interrupt")} to interrupt)`,
		);
	}

	private createLoader(): Loader {
		return new Loader(
			this.options.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			this.message ?? InteractiveWorkingController.DEFAULT_MESSAGE,
			this.indicatorOptions,
		);
	}
}
