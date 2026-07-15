import type { Agent } from "@fitclaw/agent-core";
import type { ImageContent, Message, TextContent } from "@fitclaw/ai";
import type { CustomMessage } from "./messages.js";

export interface SessionMessageQueueSnapshot {
	steering: readonly string[];
	followUp: readonly string[];
}

interface SessionMessageQueueControllerOptions {
	agent: Agent;
	onUpdate: (snapshot: SessionMessageQueueSnapshot) => void;
}

export class SessionMessageQueueController {
	private readonly agent: Agent;
	private readonly onUpdate: SessionMessageQueueControllerOptions["onUpdate"];
	private steeringMessages: string[] = [];
	private followUpMessages: string[] = [];
	private nextTurnMessages: CustomMessage[] = [];

	constructor(options: SessionMessageQueueControllerOptions) {
		this.agent = options.agent;
		this.onUpdate = options.onUpdate;
	}

	get pendingCount(): number {
		return this.steeringMessages.length + this.followUpMessages.length;
	}

	getSteeringMessages(): readonly string[] {
		return [...this.steeringMessages];
	}

	getFollowUpMessages(): readonly string[] {
		return [...this.followUpMessages];
	}

	queueSteer(text: string, images?: ImageContent[]): void {
		this.steeringMessages = [...this.steeringMessages, text];
		this.emitUpdate();
		this.agent.steer(this.createUserMessage(text, images));
	}

	queueFollowUp(text: string, images?: ImageContent[]): void {
		this.followUpMessages = [...this.followUpMessages, text];
		this.emitUpdate();
		this.agent.followUp(this.createUserMessage(text, images));
	}

	queueNextTurn(message: CustomMessage): void {
		this.nextTurnMessages = [...this.nextTurnMessages, message];
	}

	consumeNextTurnMessages(): CustomMessage[] {
		const messages = [...this.nextTurnMessages];
		this.nextTurnMessages = [];
		return messages;
	}

	removeDeliveredUserMessage(message: Message): void {
		const text = this.getUserMessageText(message);
		if (!text) return;

		const steeringIndex = this.steeringMessages.indexOf(text);
		if (steeringIndex !== -1) {
			this.steeringMessages = this.steeringMessages.filter((_, index) => index !== steeringIndex);
			this.emitUpdate();
			return;
		}

		const followUpIndex = this.followUpMessages.indexOf(text);
		if (followUpIndex !== -1) {
			this.followUpMessages = this.followUpMessages.filter((_, index) => index !== followUpIndex);
			this.emitUpdate();
		}
	}

	clear(): { steering: string[]; followUp: string[] } {
		const steering = [...this.steeringMessages];
		const followUp = [...this.followUpMessages];
		this.steeringMessages = [];
		this.followUpMessages = [];
		this.agent.clearAllQueues();
		this.emitUpdate();
		return { steering, followUp };
	}

	private emitUpdate(): void {
		this.onUpdate({
			steering: this.getSteeringMessages(),
			followUp: this.getFollowUpMessages(),
		});
	}

	private createUserMessage(text: string, images?: ImageContent[]): Message {
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images) content.push(...images);
		return { role: "user", content, timestamp: Date.now() };
	}

	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		if (typeof message.content === "string") return message.content;
		return message.content
			.filter((content) => content.type === "text")
			.map((content) => content.text)
			.join("");
	}
}
