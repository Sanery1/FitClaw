import type { FeishuEvent, FeishuUserLifecycleEvent } from "./feishu.js";
import { decideCoachRoute } from "./relationship-routing.js";
import {
	type CoachInvitationSource,
	type CoachRelationshipStore,
	createRelationship,
	FITCLAW_MEMORY_POLICY_VERSION,
} from "./relationships.js";
import type { CoachSessionScope, CoachUserScope } from "./runtime/coach-scope.js";
import { KeyedTaskQueue } from "./runtime/keyed-task-queue.js";

export const PRIVATE_COACH_INVITATION = [
	"你好，我是 FitClaw，你的一对一 AI 健身教练。",
	"启用后，我会在你的私人空间中记住长期有用的目标、训练计划、训练记录、身体指标和训练限制；这些数据不会与其他用户或群聊共享。",
	"回复“开始”表示同意启用这份成长记忆，回复“暂不”则不会建立成长档案。训练提醒默认关闭，需要你之后单独开启。",
].join("\n\n");

export const PRIVATE_COACH_ACTIVATION_PROMPT = `${PRIVATE_COACH_INVITATION}\n\n请回复“开始”或“暂不”。`;
export const GROUP_PRIVACY_REDIRECT = "为了保护你的训练和身体数据，请打开 FitClaw 私聊继续。";

export interface PrivateCoachTransport {
	sendDirectMessage(openId: string, text: string): Promise<string>;
	sendThreadMessage(parentMessageId: string, text: string): Promise<void>;
}

export interface PrivateCoachServiceOptions {
	relationships: CoachRelationshipStore;
	transport: PrivateCoachTransport;
	runCoach(event: FeishuEvent, scope: CoachSessionScope, signal: AbortSignal): Promise<void>;
	abortUserRuns?(scope: CoachUserScope): void | Promise<void>;
	resolveUserScope(event: FeishuUserLifecycleEvent): CoachUserScope;
	resolveSessionScope(event: FeishuEvent): CoachSessionScope;
	now?: () => Date;
}

export type InvitationResult =
	| { status: "invited"; messageId: string }
	| { status: "skipped" }
	| { status: "failed"; reason: string };

type MessagePreparation = { type: "handled" } | { type: "coach"; controller: AbortController };

export class PrivateCoachService {
	private readonly stateQueue = new KeyedTaskQueue();
	private readonly runQueue = new KeyedTaskQueue();
	private readonly activeRunControllers = new Map<string, Set<AbortController>>();
	private readonly now: () => Date;

	constructor(private readonly options: PrivateCoachServiceOptions) {
		this.now = options.now ?? (() => new Date());
	}

	async handleUserJoined(event: FeishuUserLifecycleEvent): Promise<InvitationResult> {
		return this.inviteUser(event, "employee_created");
	}

	async inviteUser(event: FeishuUserLifecycleEvent, source: CoachInvitationSource): Promise<InvitationResult> {
		const scope = this.options.resolveUserScope(event);
		return this.stateQueue.run(scope.userKey, async () => {
			const existing = await this.options.relationships.load(scope);
			if (existing && existing.status !== "revoked") return { status: "skipped" };

			const invitedAt = this.timestamp();
			const pending = createRelationship(scope, "invited", invitedAt, {
				invitationSource: source,
				inviteState: "pending",
				invitedAt,
			});
			await this.options.relationships.save(scope, pending);

			try {
				const messageId = await this.options.transport.sendDirectMessage(scope.openId, PRIVATE_COACH_INVITATION);
				await this.options.relationships.save(scope, {
					...pending,
					inviteState: "sent",
					inviteMessageId: messageId,
					updatedAt: this.timestamp(),
				});
				return { status: "invited", messageId };
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				const failedAt = this.timestamp();
				await this.options.relationships.save(scope, {
					...pending,
					status: "invite_failed",
					inviteState: "failed",
					inviteFailure: { at: failedAt, reason },
					updatedAt: failedAt,
				});
				return { status: "failed", reason };
			}
		});
	}

	async handleUserLeft(event: FeishuUserLifecycleEvent): Promise<void> {
		const scope = this.options.resolveUserScope(event);
		let stateError: unknown;
		try {
			await this.stateQueue.run(scope.userKey, async () => {
				try {
					await this.persistRevocation(scope, this.timestamp());
				} finally {
					this.abortActiveRuns(scope.userKey);
				}
			});
		} catch (error) {
			stateError = error;
		}

		let abortError: unknown;
		try {
			await this.options.abortUserRuns?.(scope);
		} catch (error) {
			abortError = error;
		}
		if (stateError) throw new Error("Failed to revoke the private coach relationship", { cause: stateError });
		if (abortError) throw new Error("Failed to abort active private coach runs", { cause: abortError });
	}

	async handleMessage(event: FeishuEvent): Promise<void> {
		if (event.chatType === "group") {
			await this.options.transport.sendThreadMessage(event.messageId, GROUP_PRIVACY_REDIRECT);
			return;
		}

		const scope = this.options.resolveSessionScope(event);
		const preparation = await this.stateQueue.run(scope.userKey, () => this.prepareMessage(event, scope));
		if (preparation.type === "handled") return;

		await this.runQueue.run(scope.userKey, async () => {
			try {
				if (!preparation.controller.signal.aborted) {
					await this.options.runCoach(event, scope, preparation.controller.signal);
				}
			} finally {
				this.unregisterActiveRun(scope.userKey, preparation.controller);
			}
		});
	}

	private async prepareMessage(event: FeishuEvent, scope: CoachSessionScope): Promise<MessagePreparation> {
		const relationship = await this.options.relationships.load(scope);
		if (
			!relationship ||
			relationship.status === "invite_failed" ||
			(relationship.status === "invited" && relationship.inviteState !== "sent")
		) {
			const invitedAt = this.timestamp();
			const pending = createRelationship(scope, "invited", invitedAt, {
				...(relationship ?? {}),
				invitationSource: "private_chat",
				inviteState: "pending",
				invitedAt,
			});
			await this.options.relationships.save(scope, pending);
			await this.options.transport.sendThreadMessage(event.messageId, PRIVATE_COACH_ACTIVATION_PROMPT);
			await this.options.relationships.save(scope, {
				...pending,
				inviteState: "sent",
				updatedAt: this.timestamp(),
			});
			return { type: "handled" };
		}

		const action = decideCoachRoute(event.chatType, event.text, relationship.status);
		if (action === "activation_prompt") {
			await this.options.transport.sendThreadMessage(event.messageId, PRIVATE_COACH_ACTIVATION_PROMPT);
			return { type: "handled" };
		}

		if (action === "activate") {
			const activatedAt = this.timestamp();
			await this.options.relationships.save(scope, {
				...relationship,
				status: "active",
				activatedAt,
				memoryPolicyVersion: FITCLAW_MEMORY_POLICY_VERSION,
				updatedAt: activatedAt,
			});
			await this.options.transport.sendThreadMessage(
				event.messageId,
				"私人教练已启用。训练提醒仍为关闭状态。你可以从目标、训练经验或可用器械开始告诉我。",
			);
			return { type: "handled" };
		}

		if (action === "decline" || action === "deactivate") {
			const declinedAt = this.timestamp();
			await this.options.relationships.save(scope, {
				...relationship,
				status: "declined",
				trainingRemindersEnabled: false,
				declinedAt,
				updatedAt: declinedAt,
			});
			if (action === "deactivate") {
				this.abortActiveRuns(scope.userKey);
				await this.options.abortUserRuns?.(scope);
				await this.options.transport.sendThreadMessage(
					event.messageId,
					"私人教练已停用。我不会继续读取或写入成长档案，也不会主动发送训练消息；原有数据不会自动删除。",
				);
				return { type: "handled" };
			}
			await this.options.transport.sendThreadMessage(
				event.messageId,
				"已选择暂不启用。我不会建立成长档案，也不会主动发送训练消息。",
			);
			return { type: "handled" };
		}

		if (action === "blocked") {
			if (relationship.status === "revoked") return { type: "handled" };
			await this.options.transport.sendThreadMessage(
				event.messageId,
				"你尚未启用私人教练，我不会读取或写入成长档案。",
			);
			return { type: "handled" };
		}

		if (action !== "coach") throw new Error(`Unexpected private coach route: ${action}`);
		return { type: "coach", controller: this.registerActiveRun(scope.userKey) };
	}

	private registerActiveRun(userKey: string): AbortController {
		const controller = new AbortController();
		const controllers = this.activeRunControllers.get(userKey) ?? new Set<AbortController>();
		controllers.add(controller);
		this.activeRunControllers.set(userKey, controllers);
		return controller;
	}

	private unregisterActiveRun(userKey: string, controller: AbortController): void {
		const controllers = this.activeRunControllers.get(userKey);
		controllers?.delete(controller);
		if (controllers?.size === 0) this.activeRunControllers.delete(userKey);
	}

	private abortActiveRuns(userKey: string): void {
		const controllers = this.activeRunControllers.get(userKey);
		this.activeRunControllers.delete(userKey);
		for (const controller of controllers ?? []) controller.abort();
	}

	private timestamp(): string {
		return this.now().toISOString();
	}

	private async persistRevocation(scope: CoachUserScope, revokedAt: string): Promise<void> {
		const existing = await this.options.relationships.load(scope);
		await this.options.relationships.save(scope, {
			...(existing ?? createRelationship(scope, "revoked", revokedAt)),
			status: "revoked",
			trainingRemindersEnabled: false,
			revokedAt,
			updatedAt: revokedAt,
		});
	}
}
