import type { PptxElement } from 'pptx-viewer-core';

import { animationTargetLabel } from './storyboard-animation-labels';
import { detachTimelineBinding, rebindTimelineClip } from './timeline';
import type { TimelineBinding, TimelineClip, TimelineEditResult, TimelineModel } from './timeline';

/**
 * sourceId of the visual clip covering `playheadMs` (start inclusive, end
 * exclusive), or undefined when the playhead sits in a gap or past the end.
 */
export function activeShotIdAt(timeline: TimelineModel, playheadMs: number): string | undefined {
	for (const track of timeline.tracks) {
		if (track.kind !== 'visual') {
			continue;
		}
		for (const clip of track.clips) {
			if (clip.startMs <= playheadMs && playheadMs < clip.startMs + clip.durationMs) {
				return clip.sourceId;
			}
		}
	}
	return undefined;
}

/** Start time of the visual clip backing a shot; the seek target on selection. */
export function visualClipStartMs(timeline: TimelineModel, shotId: string): number | undefined {
	return timeline.tracks
		.find((track) => track.kind === 'visual')
		?.clips.find((clip) => clip.sourceId === shotId)?.startMs;
}

/** Narration clip backing a shot, the edit target of the binding editor. */
export function narrationClipForShot(
	timeline: TimelineModel,
	shotId: string,
): TimelineClip | undefined {
	return timeline.tracks
		.find((track) => track.kind === 'narration')
		?.clips.find((clip) => clip.sourceId === shotId);
}

/** Visual clip duration per shot, mirrored back onto shots after edits. */
export function visualDurationsByShot(timeline: TimelineModel): Map<string, number> {
	const durations = new Map<string, number>();
	for (const clip of timeline.tracks.find((track) => track.kind === 'visual')?.clips ?? []) {
		if (clip.sourceId !== undefined) {
			durations.set(clip.sourceId, clip.durationMs);
		}
	}
	return durations;
}

/** Animation-track clips, offered as binding anchors to the editor. */
export function animationClipsOf(timeline: TimelineModel): TimelineClip[] {
	return timeline.tracks.find((track) => track.kind === 'animation')?.clips ?? [];
}

/**
 * Binding-editor change for a shot's narration clip: undefined detaches, a
 * binding rebinds. Returns undefined when the shot has no narration clip.
 */
export function changeShotNarrationBinding(
	timeline: TimelineModel,
	shotId: string,
	binding: TimelineBinding | undefined,
): TimelineEditResult | undefined {
	const clip = narrationClipForShot(timeline, shotId);
	if (!clip) {
		return undefined;
	}
	return binding === undefined
		? detachTimelineBinding(timeline, clip.id)
		: rebindTimelineClip(timeline, clip.id, binding);
}

/**
 * Label lookup for animation targets, built once from every slide's elements
 * plus the template layers. Slide elements win over templates on id clashes;
 * labels match the ones stamped onto animation events at group build time.
 */
export function createTargetLabelResolver(
	elementGroups: readonly (readonly PptxElement[])[],
): (targetId: string) => string | undefined {
	const labels = new Map<string, string>();
	for (const elements of elementGroups) {
		for (const element of elements) {
			if (labels.has(element.id)) {
				continue;
			}
			// Single-element lookup keeps the build linear while reusing the
			// exact label logic the animation groups already apply.
			labels.set(element.id, animationTargetLabel(element.id, [element]));
		}
	}
	// Unknown targets keep the same digest fallback the label util applies.
	return (targetId) => labels.get(targetId) ?? animationTargetLabel(targetId, []);
}
