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
	runCoach(event: FeishuEvent, scope: CoachSessionScope): Promise<void>;
	resolveUserScope(event: FeishuUserLifecycleEvent): CoachUserScope;
	resolveSessionScope(event: FeishuEvent): CoachSessionScope;
	queue?: KeyedTaskQueue;
	now?: () => Date;
}

export type InvitationResult =
	| { status: "invited"; messageId: string }
	| { status: "skipped" }
	| { status: "failed"; reason: string };

export class PrivateCoachService {
	private readonly queue: KeyedTaskQueue;
	private readonly now: () => Date;

	constructor(private readonly options: PrivateCoachServiceOptions) {
		this.queue = options.queue ?? new KeyedTaskQueue();
		this.now = options.now ?? (() => new Date());
	}

	async handleUserJoined(event: FeishuUserLifecycleEvent): Promise<InvitationResult> {
		return this.inviteUser(event, "employee_created");
	}

	async inviteUser(event: FeishuUserLifecycleEvent, source: CoachInvitationSource): Promise<InvitationResult> {
		const scope = this.options.resolveUserScope(event);
		return this.queue.run(scope.userKey, async () => {
			if (await this.options.relationships.load(scope)) return { status: "skipped" };

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
		await this.queue.run(scope.userKey, async () => {
			const existing = await this.options.relationships.load(scope);
			const revokedAt = this.timestamp();
			await this.options.relationships.save(scope, {
				...(existing ?? createRelationship(scope, "revoked", revokedAt)),
				status: "revoked",
				trainingRemindersEnabled: false,
				revokedAt,
				updatedAt: revokedAt,
			});
		});
	}

	async handleMessage(event: FeishuEvent): Promise<void> {
		if (event.chatType === "group") {
			await this.options.transport.sendThreadMessage(event.messageId, GROUP_PRIVACY_REDIRECT);
			return;
		}

		const scope = this.options.resolveSessionScope(event);
		await this.queue.run(scope.userKey, async () => {
			let relationship = await this.options.relationships.load(scope);
			const action = decideCoachRoute(event.chatType, event.text, relationship?.status);

			if (!relationship && (action === "activation_prompt" || action === "activate" || action === "decline")) {
				const invitedAt = this.timestamp();
				relationship = createRelationship(scope, "invited", invitedAt, {
					invitationSource: "private_chat",
					inviteState: "sent",
					invitedAt,
				});
				await this.options.relationships.save(scope, relationship);
			}

			if (action === "activation_prompt") {
				if (relationship?.status === "invite_failed") {
					const invitedAt = this.timestamp();
					relationship = {
						...relationship,
						status: "invited",
						invitationSource: "private_chat",
						inviteState: "sent",
						invitedAt,
						updatedAt: invitedAt,
					};
					await this.options.relationships.save(scope, relationship);
				}
				await this.options.transport.sendThreadMessage(event.messageId, PRIVATE_COACH_ACTIVATION_PROMPT);
				return;
			}

			if (action === "activate" && relationship) {
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
				return;
			}

			if (action === "decline" && relationship) {
				const declinedAt = this.timestamp();
				await this.options.relationships.save(scope, {
					...relationship,
					status: "declined",
					declinedAt,
					updatedAt: declinedAt,
				});
				await this.options.transport.sendThreadMessage(
					event.messageId,
					"已选择暂不启用。我不会建立成长档案，也不会主动发送训练消息。",
				);
				return;
			}

			if (action === "blocked") {
				await this.options.transport.sendThreadMessage(
					event.messageId,
					relationship?.status === "revoked"
						? "当前私人教练关系已停用，无法访问原有成长档案。"
						: "你尚未启用私人教练，我不会读取或写入成长档案。",
				);
				return;
			}

			if (action === "coach") await this.options.runCoach(event, scope);
		});
	}

	private timestamp(): string {
		return this.now().toISOString();
	}
}
