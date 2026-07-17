import type { SessionEntry } from "./session-format.js";

/** Tree node for getTree() - defensive copy of session structure */
export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
	/** Resolved label for this entry, if any */
	label?: string;
	/** Timestamp of the latest label change for this entry, if any */
	labelTimestamp?: string;
}

export function buildSessionTree(
	entries: SessionEntry[],
	labelsById: ReadonlyMap<string, string>,
	labelTimestampsById: ReadonlyMap<string, string>,
): SessionTreeNode[] {
	const nodeMap = new Map<string, SessionTreeNode>();
	const roots: SessionTreeNode[] = [];

	for (const entry of entries) {
		const label = labelsById.get(entry.id);
		const labelTimestamp = labelTimestampsById.get(entry.id);
		nodeMap.set(entry.id, { entry, children: [], label, labelTimestamp });
	}

	for (const entry of entries) {
		const node = nodeMap.get(entry.id)!;
		if (entry.parentId === null || entry.parentId === entry.id) {
			roots.push(node);
		} else {
			const parent = nodeMap.get(entry.parentId);
			if (parent) {
				parent.children.push(node);
			} else {
				roots.push(node);
			}
		}
	}

	const stack: SessionTreeNode[] = [...roots];
	while (stack.length > 0) {
		const node = stack.pop()!;
		node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
		stack.push(...node.children);
	}

	return roots;
}
