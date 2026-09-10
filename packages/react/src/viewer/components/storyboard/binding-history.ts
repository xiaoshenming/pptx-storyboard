import type { StoryboardProjectSnapshot } from './storyboard-project-store';
import type { TimelineBinding } from './timeline/binding';
import type { TimelineClip, TimelineModel } from './timeline/types';

export type StoryboardBindingEventAction = 'bind' | 'rebind' | 'detach' | 'lock' | 'unlock';

export interface StoryboardBindingEvent {
	at: string;
	clipId: string;
	action: StoryboardBindingEventAction;
	from?: TimelineBinding;
	to?: TimelineBinding;
}

/** Upper bound for retained binding events; the newest entries win. */
export const MAX_BINDING_HISTORY = 50;

const BINDING_ACTION_SET = new Set<string>(['bind', 'rebind', 'detach', 'lock', 'unlock']);

/**
 * Binding content identity: anchorId, mode, offsetMs and locked. The clip
 * start time is deliberately excluded because it is derived from the binding
 * (and from free dragging), not part of what the user bound to what.
 */
function bindingFingerprint(binding: TimelineBinding): string {
	return JSON.stringify([binding.anchorId, binding.mode, binding.offsetMs, binding.locked]);
}

function narrationClips(timeline: TimelineModel | undefined): TimelineClip[] {
	if (!timeline) {
		return [];
	}
	const clips: TimelineClip[] = [];
	for (const track of timeline.tracks) {
		if (track.kind === 'narration') {
			clips.push(...track.clips);
		}
	}
	return clips;
}

function diffClipBinding(
	clipId: string,
	before: TimelineBinding | undefined,
	after: TimelineBinding | undefined,
): Omit<StoryboardBindingEvent, 'at'> | undefined {
	if (!before && after) {
		return { clipId, action: 'bind', to: after };
	}
	if (before && !after) {
		return { clipId, action: 'detach', from: before };
	}
	if (!before || !after) {
		return undefined;
	}
	if (bindingFingerprint(before) === bindingFingerprint(after)) {
		return undefined;
	}
	if (
		before.anchorId === after.anchorId &&
		before.mode === after.mode &&
		before.offsetMs === after.offsetMs
	) {
		// Only the lock flag moved, so this is a lock/unlock, not a rebind.
		return { clipId, action: after.locked ? 'lock' : 'unlock', from: before, to: after };
	}
	return { clipId, action: 'rebind', from: before, to: after };
}

/**
 * Compare the narration-track bindings of two timelines. Events are returned
 * in track-then-clip order and share one batch timestamp. Clips that only
 * exist in `previous` are ignored: deleting a clip removes its binding with
 * it, which is not a user-visible detach of a surviving clip.
 */
export function diffStoryboardBindings(
	previous: TimelineModel | undefined,
	next: TimelineModel,
): StoryboardBindingEvent[] {
	const previousById = new Map<string, TimelineBinding>();
	for (const clip of narrationClips(previous)) {
		if (clip.binding) {
			previousById.set(clip.id, clip.binding);
		}
	}
	const at = new Date().toISOString();
	const events: StoryboardBindingEvent[] = [];
	for (const clip of narrationClips(next)) {
		const event = diffClipBinding(clip.id, previousById.get(clip.id), clip.binding);
		if (event) {
			events.push({ ...event, at });
		}
	}
	return events;
}

/**
 * Append events to the snapshot history (newest last) and bump the revision
 * once per batch. Pure: with no events the input reference comes back so
 * callers can skip a write entirely.
 */
export function recordBindingEvents(
	snapshot: StoryboardProjectSnapshot,
	events: StoryboardBindingEvent[],
): StoryboardProjectSnapshot {
	if (events.length === 0) {
		return snapshot;
	}
	return {
		...snapshot,
		bindingRevision: snapshot.bindingRevision + 1,
		bindingHistory: [...snapshot.bindingHistory, ...events].slice(-MAX_BINDING_HISTORY),
	};
}

export function isStoryboardBindingEvent(value: unknown): value is StoryboardBindingEvent {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const event = value as Record<string, unknown>;
	if (typeof event.at !== 'string' || typeof event.clipId !== 'string') {
		return false;
	}
	if (typeof event.action !== 'string' || !BINDING_ACTION_SET.has(event.action)) {
		return false;
	}
	for (const edge of [event.from, event.to]) {
		if (edge !== undefined && (typeof edge !== 'object' || edge === null)) {
			return false;
		}
	}
	return true;
}
