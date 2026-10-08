import type { NarrationDraft, NarrationMaterial } from 'pptx-viewer-shared';

import type { StoryboardShot } from './storyboard-model';

export interface NarrationConnection {
	baseURL: string;
	model: string;
	apiKey: string;
}
export interface PageNarrationDraft {
	page: number;
	material: NarrationMaterial;
	draft: NarrationDraft;
	baseline: Record<string, string>;
	cached: boolean;
	applied?: boolean;
	editedShotIds?: string[];
}
export function narrationProtected(shot: StoryboardShot, generated?: StoryboardShot): boolean {
	return (
		shot.scriptLocked ??
		(shot.scriptOrigin === 'manual' ||
			(!shot.scriptOrigin && Boolean(generated && shot.script !== generated.script)))
	);
}
export function applicableNarrationNodes(
	nodes: NarrationDraft['nodes'],
	baseline: Record<string, string>,
	current: StoryboardShot[],
	generated: StoryboardShot[],
) {
	return nodes.filter((node) => {
		const shot = current.find((s) => s.id === node.shotId);
		return (
			shot &&
			shot.script === baseline[shot.id] &&
			!narrationProtected(
				shot,
				generated.find((s) => s.id === shot.id),
			)
		);
	});
}

export function narrationNodePatch(
	node: NarrationDraft['nodes'][number],
	manuallyEdited: boolean,
): Partial<StoryboardShot> {
	return {
		script: node.text,
		scriptOrigin: manuallyEdited ? 'manual' : 'ai',
		...(manuallyEdited ? { scriptLocked: true } : {}),
		scriptCues: { preCue: '', revealCue: node.text, postCue: '' },
	};
}
export function collectNarrationApplication(
	pages: PageNarrationDraft[],
	current: StoryboardShot[],
	generated: StoryboardShot[],
) {
	const pending = pages.filter((page) => !page.applied);
	const nodes = pending.flatMap((page) =>
		applicableNarrationNodes(page.draft.nodes, page.baseline, current, generated),
	);
	const ids = new Set(nodes.map((node) => node.shotId));
	return {
		nodes,
		pageNumbers: pending.map((page) => page.page),
		editedShotIds: pending.flatMap((page) => page.editedShotIds ?? []).filter((id) => ids.has(id)),
		skipped: pending.reduce((n, page) => n + page.draft.nodes.length, 0) - nodes.length,
	};
}
