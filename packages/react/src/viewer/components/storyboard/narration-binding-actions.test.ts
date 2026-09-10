import { describe, expect, it } from 'vitest';

import {
	clipMetadataString,
	defaultBindingForNarration,
	resolveBindingBadge,
	resolveNarrationDrop,
	toggleNarrationBindingLock,
} from './narration-binding-actions';
import { createTimelineBinding, createTimelineModel, createTimelineTrack } from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

// 80 px/s makes the default 8px magnet radius exactly 100ms.
const PPS = 80;

function animationClip(
	id: string,
	startMs: number,
	sourceId?: string,
	durationMs = 1000,
): TimelineClip {
	return { id, trackId: 'track-animation', kind: 'animation', startMs, durationMs, sourceId };
}

function narrationClip(
	id: string,
	startMs: number,
	binding?: TimelineClip['binding'],
	durationMs = 2000,
): TimelineClip {
	return { id, trackId: 'track-narration', kind: 'narration', startMs, durationMs, binding };
}

function buildTimeline(clips: TimelineClip[]): TimelineModel {
	return createTimelineModel([
		createTimelineTrack('visual'),
		createTimelineTrack(
			'animation',
			clips.filter((clip) => clip.kind === 'animation'),
		),
		createTimelineTrack(
			'narration',
			clips.filter((clip) => clip.kind === 'narration'),
		),
		createTimelineTrack('subtitle'),
	]);
}

describe('resolveNarrationDrop', () => {
	it('snaps and binds when the drop lands inside the magnet radius', () => {
		const timeline = buildTimeline([animationClip('a1', 5000)]);
		const decision = resolveNarrationDrop({
			timeline,
			clip: narrationClip('n1', 8000),
			proposedStartMs: 5040,
			pixelsPerSecond: PPS,
		});
		expect(decision.detach).toBeFalsy();
		expect(decision.snapTimeMs).toBe(5000);
		expect(decision.binding).toStrictEqual(createTimelineBinding('a1', 'with-animation', 0));
	});

	it('stays free beyond the radius and detaches an existing binding', () => {
		const timeline = buildTimeline([animationClip('a1', 5000)]);
		const bound = narrationClip('n1', 5000, createTimelineBinding('a1', 'with-animation'));
		const decision = resolveNarrationDrop({
			timeline,
			clip: bound,
			proposedStartMs: 5300,
			pixelsPerSecond: PPS,
		});
		expect(decision.binding).toBeUndefined();
		expect(decision.snapTimeMs).toBeUndefined();
		expect(decision.detach).toBeTruthy();
	});

	it('reports no detach when an unbound clip lands free', () => {
		const timeline = buildTimeline([animationClip('a1', 5000)]);
		const decision = resolveNarrationDrop({
			timeline,
			clip: narrationClip('n1', 8000),
			proposedStartMs: 5300,
			pixelsPerSecond: PPS,
		});
		expect(decision.detach).toBeFalsy();
	});

	it('honors a custom pixel threshold', () => {
		const timeline = buildTimeline([animationClip('a1', 5000)]);
		const decision = resolveNarrationDrop({
			timeline,
			clip: narrationClip('n1', 8000),
			proposedStartMs: 5030,
			pixelsPerSecond: PPS,
			thresholdPx: 2,
		});
		expect(decision.binding).toBeUndefined();
		expect(decision.detach).toBeFalsy();
	});
});

describe('defaultBindingForNarration', () => {
	it('prefers the earliest animation of the same source shot', () => {
		const timeline = buildTimeline([
			animationClip('a-other', 6000, 'shot-2'),
			animationClip('a-late', 8000, 'shot-1'),
			animationClip('a-early', 2000, 'shot-1'),
		]);
		expect(defaultBindingForNarration(timeline, narrationClip('n1', 0))).toStrictEqual(
			createTimelineBinding('a-early', 'with-animation', 0),
		);
	});

	it('falls back to the earliest timeline animation for unmatched shots', () => {
		const timeline = buildTimeline([
			animationClip('a-late', 8000, 'shot-1'),
			animationClip('a-early', 2000, 'shot-2'),
		]);
		expect(defaultBindingForNarration(timeline, narrationClip('n1', 0))).toStrictEqual(
			createTimelineBinding('a-early', 'with-animation', 0),
		);
	});

	it('returns undefined when the timeline has no animation anchors', () => {
		expect(defaultBindingForNarration(buildTimeline([]), narrationClip('n1', 0))).toBeUndefined();
	});
});

describe('resolveBindingBadge', () => {
	it('uses the anchor label from animation clip metadata', () => {
		const anchor = {
			...animationClip('a1', 5000),
			metadata: { anchorLabel: 'A1', targetLabel: '数字 60' },
		};
		const timeline = buildTimeline([
			anchor,
			narrationClip('n1', 5300, createTimelineBinding('a1', 'with-animation', 300)),
		]);
		expect(resolveBindingBadge(timeline, timeline.tracks[2].clips[0])).toBe('🔗 A1 +0.3s');
	});

	it('falls back to the raw anchor id when the anchor is missing', () => {
		const timeline = buildTimeline([
			narrationClip('n1', 5300, createTimelineBinding('a-missing', 'with-animation', 300)),
		]);
		expect(resolveBindingBadge(timeline, timeline.tracks[2].clips[0])).toBe('🔗 a-missing +0.3s');
	});

	it('falls back to the raw anchor id when metadata has no anchorLabel', () => {
		const timeline = buildTimeline([
			animationClip('a1', 5000),
			narrationClip('n1', 5000, createTimelineBinding('a1', 'with-animation')),
		]);
		expect(resolveBindingBadge(timeline, timeline.tracks[2].clips[0])).toBe('🔗 a1');
	});

	it('returns undefined for unbound clips', () => {
		const timeline = buildTimeline([animationClip('a1', 5000), narrationClip('n1', 5000)]);
		expect(resolveBindingBadge(timeline, timeline.tracks[2].clips[0])).toBeUndefined();
	});
});

describe('clipMetadataString', () => {
	it('returns only non-empty string values', () => {
		expect(clipMetadataString({ key: 'A1' }, 'key')).toBe('A1');
		expect(clipMetadataString({ key: '' }, 'key')).toBeUndefined();
		expect(clipMetadataString({ key: 42 }, 'key')).toBeUndefined();
		expect(clipMetadataString(undefined, 'key')).toBeUndefined();
	});
});

describe('toggleNarrationBindingLock', () => {
	it('locks and unlocks without moving the clip', () => {
		const binding = createTimelineBinding('a1', 'with-animation');
		const timeline = buildTimeline([animationClip('a1', 5000), narrationClip('n1', 5000, binding)]);
		const locked = toggleNarrationBindingLock(timeline, 'n1', true);
		expect(locked.accepted).toBeTruthy();
		expect(locked.timeline.tracks[2].clips[0].binding?.locked).toBeTruthy();
		const unlocked = toggleNarrationBindingLock(locked.timeline, 'n1', false);
		expect(unlocked.accepted).toBeTruthy();
		expect(unlocked.timeline.tracks[2].clips[0].binding?.locked).toBeFalsy();
		expect(unlocked.timeline.tracks[2].clips[0].startMs).toBe(5000);
	});

	it('rejects non-narration clips and clips without a binding', () => {
		const timeline = buildTimeline([animationClip('a1', 5000), narrationClip('n1', 5000)]);
		expect(toggleNarrationBindingLock(timeline, 'a1', true).accepted).toBeFalsy();
		expect(toggleNarrationBindingLock(timeline, 'n1', true).accepted).toBeFalsy();
	});
});
