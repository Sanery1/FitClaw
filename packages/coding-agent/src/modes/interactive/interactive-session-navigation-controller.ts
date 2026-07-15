import { type Component, type Container, type EditorComponent, Loader, Spacer, type TUI } from "@fitclaw/tui";
import type { AgentSession } from "../../core/agent-session.js";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.js";
import type { ExtensionCommandContext } from "../../core/extensions/index.js";
import type { KeybindingsManager } from "../../core/keybindings.js";
import { MissingSessionCwdError } from "../../core/session-cwd.js";
import { SessionManager } from "../../core/session-manager.js";
import type { CustomEditor } from "./components/custom-editor.js";
import { keyText } from "./components/keybinding-hints.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { TreeSelectorComponent } from "./components/tree-selector.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import { theme } from "./theme/theme.js";

type SelectorFactory = (done: () => void) => { component: Component; focus: Component };
type SwitchSessionOptions = Parameters<ExtensionCommandContext["switchSession"]>[1];

export interface InteractiveSessionNavigationControllerOptions {
	getSession: () => AgentSession;
	runtimeHost: Pick<AgentSessionRuntime, "fork" | "switchSession">;
	ui: TUI;
	chatContainer: Container;
	statusContainer: Container;
	defaultEditor: CustomEditor;
	getEditor: () => EditorComponent;
	keybindings: KeybindingsManager;
	showSelector: (create: SelectorFactory) => void;
	showExtensionSelector: (title: string, options: string[]) => Promise<string | undefined>;
	showExtensionEditor: (title: string) => Promise<string | undefined>;
	promptForMissingSessionCwd: (error: MissingSessionCwdError) => Promise<string | undefined>;
	stopWorkingLoader: () => void;
	renderCurrentSessionState: () => void;
	renderInitialMessages: () => void;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
	handleFatalRuntimeError: (prefix: string, error: unknown) => Promise<never>;
	flushCompactionQueue: (options?: { willRetry?: boolean }) => Promise<void>;
	shutdown: () => Promise<void>;
}

export class InteractiveSessionNavigationController {
	constructor(private readonly options: InteractiveSessionNavigationControllerOptions) {}

	private get session(): AgentSession {
		return this.options.getSession();
	}

	private get editor(): EditorComponent {
		return this.options.getEditor();
	}

	showUserMessageSelector(): void {
		const userMessages = this.session.getUserMessagesForForking();

		if (userMessages.length === 0) {
			this.options.showStatus("No messages to fork from");
			return;
		}

		const initialSelectedId = userMessages[userMessages.length - 1]?.entryId;

		this.options.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((message) => ({ id: message.entryId, text: message.text })),
				async (entryId) => {
					try {
						const result = await this.options.runtimeHost.fork(entryId);
						if (result.cancelled) {
							done();
							this.options.ui.requestRender();
							return;
						}

						this.options.renderCurrentSessionState();
						this.editor.setText(result.selectedText ?? "");
						done();
						this.options.showStatus("Forked to new session");
					} catch (error: unknown) {
						done();
						this.options.showError(error instanceof Error ? error.message : String(error));
					}
				},
				() => {
					done();
					this.options.ui.requestRender();
				},
				initialSelectedId,
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	async handleCloneCommand(): Promise<void> {
		const leafId = this.session.sessionManager.getLeafId();
		if (!leafId) {
			this.options.showStatus("Nothing to clone yet");
			return;
		}

		try {
			const result = await this.options.runtimeHost.fork(leafId, { position: "at" });
			if (result.cancelled) {
				this.options.ui.requestRender();
				return;
			}

			this.options.renderCurrentSessionState();
			this.editor.setText("");
			this.options.showStatus("Cloned to new session");
		} catch (error: unknown) {
			this.options.showError(error instanceof Error ? error.message : String(error));
		}
	}

	showTreeSelector(initialSelectedId?: string): void {
		const sessionManager = this.session.sessionManager;
		const tree = sessionManager.getTree();
		const realLeafId = sessionManager.getLeafId();
		const initialFilterMode = this.session.settingsManager.getTreeFilterMode();

		if (tree.length === 0) {
			this.options.showStatus("No entries in session");
			return;
		}

		this.options.showSelector((done) => {
			const selector = new TreeSelectorComponent(
				tree,
				realLeafId,
				this.options.ui.terminal.rows,
				async (entryId) => {
					if (entryId === realLeafId) {
						done();
						this.options.showStatus("Already at this point");
						return;
					}

					done();
					let wantsSummary = false;
					let customInstructions: string | undefined;

					if (!this.session.settingsManager.getBranchSummarySkipPrompt()) {
						while (true) {
							const summaryChoice = await this.options.showExtensionSelector("Summarize branch?", [
								"No summary",
								"Summarize",
								"Summarize with custom prompt",
							]);

							if (summaryChoice === undefined) {
								this.showTreeSelector(entryId);
								return;
							}

							wantsSummary = summaryChoice !== "No summary";

							if (summaryChoice === "Summarize with custom prompt") {
								customInstructions = await this.options.showExtensionEditor(
									"Custom summarization instructions",
								);
								if (customInstructions === undefined) {
									continue;
								}
							}

							break;
						}
					}

					let summaryLoader: Loader | undefined;
					const originalOnEscape = this.options.defaultEditor.onEscape;

					if (wantsSummary) {
						this.options.defaultEditor.onEscape = () => {
							this.session.abortBranchSummary();
						};
						this.options.chatContainer.addChild(new Spacer(1));
						summaryLoader = new Loader(
							this.options.ui,
							(spinner) => theme.fg("accent", spinner),
							(text) => theme.fg("muted", text),
							`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
						);
						this.options.statusContainer.addChild(summaryLoader);
						this.options.ui.requestRender();
					}

					try {
						const result = await this.session.navigateTree(entryId, {
							summarize: wantsSummary,
							customInstructions,
						});

						if (result.aborted) {
							this.options.showStatus("Branch summarization cancelled");
							this.showTreeSelector(entryId);
							return;
						}
						if (result.cancelled) {
							this.options.showStatus("Navigation cancelled");
							return;
						}

						this.options.chatContainer.clear();
						this.options.renderInitialMessages();
						if (result.editorText && !this.editor.getText().trim()) {
							this.editor.setText(result.editorText);
						}
						this.options.showStatus("Navigated to selected point");
						void this.options.flushCompactionQueue({ willRetry: false });
					} catch (error: unknown) {
						this.options.showError(error instanceof Error ? error.message : String(error));
					} finally {
						if (summaryLoader) {
							summaryLoader.stop();
							this.options.statusContainer.clear();
						}
						this.options.defaultEditor.onEscape = originalOnEscape;
					}
				},
				() => {
					done();
					this.options.ui.requestRender();
				},
				(entryId, label) => {
					this.session.sessionManager.appendLabelChange(entryId, label);
					this.options.ui.requestRender();
				},
				initialSelectedId,
				initialFilterMode,
			);
			return { component: selector, focus: selector };
		});
	}

	showSessionSelector(): void {
		this.options.showSelector((done) => {
			const sessionManager = this.session.sessionManager;
			const selector = new SessionSelectorComponent(
				(onProgress) => SessionManager.list(sessionManager.getCwd(), sessionManager.getSessionDir(), onProgress),
				SessionManager.listAll,
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.options.ui.requestRender();
				},
				() => {
					void this.options.shutdown();
				},
				() => this.options.ui.requestRender(),
				{
					renameSession: async (sessionFilePath: string, nextName: string | undefined) => {
						const next = (nextName ?? "").trim();
						if (!next) return;
						const manager = SessionManager.open(sessionFilePath);
						manager.appendSessionInfo(next);
					},
					showRenameHint: true,
					keybindings: this.options.keybindings,
				},
				sessionManager.getSessionFile(),
			);
			return { component: selector, focus: selector };
		});
	}

	async handleResumeSession(sessionPath: string, options?: SwitchSessionOptions): Promise<{ cancelled: boolean }> {
		this.options.stopWorkingLoader();
		try {
			const result = await this.options.runtimeHost.switchSession(sessionPath, {
				withSession: options?.withSession,
			});
			if (result.cancelled) {
				return result;
			}
			this.options.renderCurrentSessionState();
			this.options.showStatus("Resumed session");
			return result;
		} catch (error: unknown) {
			if (error instanceof MissingSessionCwdError) {
				const selectedCwd = await this.options.promptForMissingSessionCwd(error);
				if (!selectedCwd) {
					this.options.showStatus("Resume cancelled");
					return { cancelled: true };
				}
				const result = await this.options.runtimeHost.switchSession(sessionPath, {
					cwdOverride: selectedCwd,
					withSession: options?.withSession,
				});
				if (result.cancelled) {
					return result;
				}
				this.options.renderCurrentSessionState();
				this.options.showStatus("Resumed session in current cwd");
				return result;
			}
			return this.options.handleFatalRuntimeError("Failed to resume session", error);
		}
	}
}
