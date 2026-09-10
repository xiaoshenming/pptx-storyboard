import {
	bindingBadgeText,
	createTimelineBinding,
	findAnimationAnchorClip,
	findNearestAnimationAnchor,
	findTimelineClip,
	pixelsToMilliseconds,
	sortClips,
	updateTimelineTracks,
} from './timeline';
import type { TimelineBinding, TimelineClip, TimelineEditResult, TimelineModel } from './timeline';

export function clipMetadataString(
	metadata: Readonly<Record<string, unknown>> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** `A1 +0.3s` style badge text, resolved against the binding's anchor metadata. */
export function resolveBindingBadge(
	timeline: TimelineModel,
	clip: TimelineClip,
): string | undefined {
	if (!clip.binding) {
		return undefined;
	}
	const anchor = findAnimationAnchorClip(timeline, clip.binding.anchorId);
	const label =
		(anchor && clipMetadataString(anchor.metadata, 'anchorLabel')) || clip.binding.anchorId;
	return bindingBadgeText(clip.binding, label);
}

/** Outcome of releasing a dragged narration clip. */
export interface NarrationDropDecision {
	/** New binding when the drop snapped onto an animation anchor. */
	binding?: TimelineBinding;
	/** Free landing that must release an existing binding (team decision). */
	detach: boolean;
	/** Landing time after snapping; equals the anchor start. */
	snapTimeMs?: number;
}

export interface NarrationDropInput {
	timeline: TimelineModel;
	clip: TimelineClip;
	proposedStartMs: number;
	pixelsPerSecond: number;
	/** Magnet radius in on-screen pixels; defaults to 8. */
	thresholdPx?: number;
}

/**
 * Decides what a narration drop means: landing within the magnet radius of an
 * animation anchor snaps and binds to it ("with animation", zero offset); any
 * other landing is free time, which detaches an existing binding.
 */
export function resolveNarrationDrop(input: NarrationDropInput): NarrationDropDecision {
	const thresholdMs = pixelsToMilliseconds(input.thresholdPx ?? 8, input.pixelsPerSecond);
	const nearest = findNearestAnimationAnchor(input.timeline, input.proposedStartMs, {
		maxDistanceMs: thresholdMs,
	});
	if (!nearest) {
		return { detach: input.clip.binding !== undefined };
	}
	const snapTimeMs = Math.max(0, nearest.anchorStartMs);
	return {
		// 落点即锚点起点，吸附落点的 offset 恒为 0（脏数据负 startMs 被 max 归零时亦然）。
		binding: createTimelineBinding(nearest.anchorId, 'with-animation', 0),
		detach: false,
		snapTimeMs,
	};
}

/**
 * Restores the canonical binding for a narration clip: the earliest animation
 * of the same source shot, falling back to the first animation on the timeline.
 */
export function defaultBindingForNarration(
	timeline: TimelineModel,
	narrationClip: TimelineClip,
): TimelineBinding | undefined {
	const anchors = sortClips(
		timeline.tracks.filter((track) => track.kind === 'animation').flatMap((track) => track.clips),
	);
	if (anchors.length === 0) {
		return undefined;
	}
	const anchor =
		anchors.find(
			(candidate) => candidate.sourceId && candidate.sourceId === narrationClip.sourceId,
		) ?? anchors[0];
	return createTimelineBinding(anchor.id, 'with-animation', 0);
}

/** Flips `locked` on a narration clip's binding without touching its time. */
export function toggleNarrationBindingLock(
	timeline: TimelineModel,
	clipId: string,
	locked: boolean,
): TimelineEditResult {
	const found = findTimelineClip(timeline, clipId);
	const binding = found?.clip.binding;
	if (!found || found.track.kind !== 'narration' || !binding) {
		return { timeline, accepted: false, clipIds: [], collisionIds: [] };
	}
	const tracks = timeline.tracks.map((track) =>
		track.id === found.track.id
			? {
					...track,
					clips: track.clips.map((clip) =>
						clip.id === clipId ? { ...clip, binding: { ...binding, locked } } : clip,
					),
				}
			: track,
	);
	return {
		timeline: updateTimelineTracks(timeline, tracks),
		accepted: true,
		clipIds: [clipId],
		collisionIds: [],
	};
}
