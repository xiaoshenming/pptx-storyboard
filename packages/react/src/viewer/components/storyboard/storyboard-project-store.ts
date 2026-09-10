import type { StoryboardBindingEvent } from './binding-history';
import { isStoryboardBindingEvent } from './binding-history';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';

export {
	diffStoryboardBindings,
	MAX_BINDING_HISTORY,
	recordBindingEvents,
} from './binding-history';
export type { StoryboardBindingEvent, StoryboardBindingEventAction } from './binding-history';

export interface StoryboardProjectSnapshot {
	schemaVersion: 2;
	projectId: string;
	fileName: string;
	updatedAt: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	lastJob?: StoryboardJobProgress;
	bindingRevision: number;
	bindingHistory: StoryboardBindingEvent[];
}

// The storage key keeps its original v1 namespace so snapshots written before
// schema v2 are still found on disk and migrated in place on load.
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function hasTimelineTracks(value: unknown): boolean {
	return isRecord(value) && Array.isArray(value.tracks);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function migrateV1Snapshot(value: Record<string, unknown>): StoryboardProjectSnapshot | null {
	if (
		typeof value.projectId !== 'string' ||
		!Array.isArray(value.shots) ||
		!hasTimelineTracks(value.timeline)
	) {
		return null;
	}
	return {
		schemaVersion: 2,
		projectId: value.projectId,
		fileName: typeof value.fileName === 'string' ? value.fileName : '',
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
		shots: value.shots as StoryboardShot[],
		timeline: value.timeline as TimelineModel,
		lastJob: value.lastJob as StoryboardJobProgress | undefined,
		bindingRevision: 0,
		bindingHistory: [],
	};
}

function validateV2Snapshot(value: Record<string, unknown>): StoryboardProjectSnapshot | null {
	if (typeof value.projectId !== 'string' || typeof value.fileName !== 'string') {
		return null;
	}
	if (typeof value.updatedAt !== 'string' || !Array.isArray(value.shots)) {
		return null;
	}
	if (!hasTimelineTracks(value.timeline)) {
		return null;
	}
	if (!isNonNegativeInteger(value.bindingRevision)) {
		return null;
	}
	if (
		!Array.isArray(value.bindingHistory) ||
		!value.bindingHistory.every(isStoryboardBindingEvent)
	) {
		return null;
	}
	return {
		schemaVersion: 2,
		projectId: value.projectId,
		fileName: value.fileName,
		updatedAt: value.updatedAt,
		shots: value.shots as StoryboardShot[],
		timeline: value.timeline as TimelineModel,
		lastJob: value.lastJob as StoryboardJobProgress | undefined,
		bindingRevision: value.bindingRevision,
		bindingHistory: value.bindingHistory as StoryboardBindingEvent[],
	};
}

/**
 * Accept a persisted snapshot of any schema version and return the current
 * v2 shape, or null when the value cannot be interpreted as a snapshot.
 * v1 payloads keep shots, timeline, lastJob and updatedAt untouched and start
 * with an empty binding audit trail.
 */
export function migrateStoryboardSnapshot(value: unknown): StoryboardProjectSnapshot | null {
	if (!isRecord(value)) {
		return null;
	}
	if (value.schemaVersion === 1) {
		return migrateV1Snapshot(value);
	}
	if (value.schemaVersion === 2) {
		return validateV2Snapshot(value);
	}
	return null;
}

export function loadStoryboardProject(projectId: string): StoryboardProjectSnapshot | null {
	try {
		const raw = localStorage.getItem(projectKey(projectId));
		if (!raw) {
			return null;
		}
		const migrated = migrateStoryboardSnapshot(JSON.parse(raw) as unknown);
		if (!migrated || migrated.projectId !== projectId) {
			return null;
		}
		return migrated;
	} catch {
		return null;
	}
}

export function saveStoryboardProject(snapshot: StoryboardProjectSnapshot): void {
	localStorage.setItem(projectKey(snapshot.projectId), JSON.stringify(snapshot));
}
