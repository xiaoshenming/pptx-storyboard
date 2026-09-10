import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';

export interface StoryboardProjectSnapshot {
	schemaVersion: 1;
	projectId: string;
	fileName: string;
	updatedAt: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	lastJob?: StoryboardJobProgress;
}

function projectKey(projectId: string): string {
	return `pptx-viewer:storyboard-project:v1:${encodeURIComponent(projectId)}`;
}

export function storyboardProjectId(fileName: string, shots: StoryboardShot[]): string {
	const source = JSON.stringify({
		fileName: fileName.normalize('NFKC'),
		shots: shots.map((shot) => ({
			id: shot.id,
			label: shot.label,
			effectLabel: shot.effectLabel,
			script: shot.script,
			animationEvents: shot.animationEvents,
		})),
	});
	let hash = 2166136261;
	for (const character of source) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return `project_${(hash >>> 0).toString(36)}`;
}

export function loadStoryboardProject(projectId: string): StoryboardProjectSnapshot | null {
	try {
		const raw = localStorage.getItem(projectKey(projectId));
		if (!raw) {
			return null;
		}
		const value = JSON.parse(raw) as Partial<StoryboardProjectSnapshot>;
		if (value.schemaVersion !== 1 || value.projectId !== projectId) {
			return null;
		}
		if (!Array.isArray(value.shots) || !value.timeline || !Array.isArray(value.timeline.tracks)) {
			return null;
		}
		return value as StoryboardProjectSnapshot;
	} catch {
		return null;
	}
}

export function saveStoryboardProject(snapshot: StoryboardProjectSnapshot): void {
	localStorage.setItem(projectKey(snapshot.projectId), JSON.stringify(snapshot));
}
