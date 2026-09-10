import { describe, expect, it } from 'vitest';

import {
	applyNarrationBindings,
	bindingBadgeText,
	createTimelineBinding,
	detachTimelineBinding,
	describeTimelineBinding,
	findAnimationAnchorClip,
	findNearestAnimationAnchor,
	moveNarrationClipFreely,
	rebindTimelineClip,
	resolveBindingStartMs,
	validateNarrationBindings,
} from './binding';
import { createTimelineModel, createTimelineTrack } from './model';
import type { TimelineClip, TimelineModel } from './types';

function animationClip(id: string, startMs: number, durationMs: number): TimelineClip {
	return { id, trackId: 'track-animation', kind: 'animation', startMs, durationMs };
}

function narrationClip(
	id: string,
	startMs: number,
	durationMs: number,
	binding?: TimelineClip['binding'],
): TimelineClip {
	return { id, trackId: 'track-narration', kind: 'narration', startMs, durationMs, binding };
}

function buildTimeline(clips: TimelineClip[]): TimelineModel {
	return createTimelineModel([
		createTimelineTrack(
			'animation',
			clips.filter((clip) => clip.kind === 'animation'),
		),
		createTimelineTrack(
			'narration',
			clips.filter((clip) => clip.kind === 'narration'),
		),
	]);
}

describe('resolveBindingStartMs', () => {
	const timeline = buildTimeline([animationClip('animation-a', 1000, 500)]);

	it('appends the offset for with-animation', () => {
		const bound = narrationClip(
			'n1',
			0,
			400,
			createTimelineBinding('animation-a', 'with-animation', 300),
		);
		expect(resolveBindingStartMs(timeline, bound)).toBe(1300);
		const negative = narrationClip(
			'n2',
			0,
			400,
			createTimelineBinding('animation-a', 'with-animation', -200),
		);
		expect(resolveBindingStartMs(timeline, negative)).toBe(800);
	});

	it('starts after the anchor ends for after-animation', () => {
		const bound = narrationClip(
			'n1',
			0,
			400,
			createTimelineBinding('animation-a', 'after-animation', 300),
		);
		expect(resolveBindingStartMs(timeline, bound)).toBe(1800);
		const negative = narrationClip(
			'n2',
			0,
			400,
			createTimelineBinding('animation-a', 'after-animation', -200),
		);
		expect(resolveBindingStartMs(timeline, negative)).toBe(1300);
	});

	it('ends right before the anchor for before-animation', () => {
		const bound = narrationClip(
			'n1',
			0,
			400,
			createTimelineBinding('animation-a', 'before-animation'),
		);
		expect(resolveBindingStartMs(timeline, bound)).toBe(600);
		const offset = narrationClip(
			'n1',
			0,
			400,
			createTimelineBinding('animation-a', 'before-animation', 300),
		);
		expect(resolveBindingStartMs(timeline, offset)).toBe(900);
		const negative = narrationClip(
			'n2',
			0,
			400,
			createTimelineBinding('animation-a', 'before-animation', -200),
		);
		expect(resolveBindingStartMs(timeline, negative)).toBe(400);
	});

	it('returns undefined without a binding or with a missing anchor', () => {
		expect(resolveBindingStartMs(timeline, narrationClip('n1', 0, 400))).toBeUndefined();
		const orphan = narrationClip(
			'n1',
			0,
			400,
			createTimelineBinding('animation-missing', 'with-animation'),
		);
		expect(resolveBindingStartMs(timeline, orphan)).toBeUndefined();
	});
});

describe('findAnimationAnchorClip', () => {
	it('finds clips on animation tracks only', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip('animation-b', 0, 400),
		]);
		expect(findAnimationAnchorClip(timeline, 'animation-a')?.id).toBe('animation-a');
		expect(findAnimationAnchorClip(timeline, 'animation-b')).toBeUndefined();
	});
});

describe('applyNarrationBindings', () => {
	it('moves bound narration clips with their anchor and updates durationMs', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip('n1', 0, 800, createTimelineBinding('animation-a', 'with-animation', 200)),
		]);
		const next = applyNarrationBindings(timeline);
		expect(next).not.toBe(timeline);
		expect(next.tracks[1].clips[0].startMs).toBe(1200);
		expect(next.durationMs).toBe(2000);
	});

	it('clamps resolved starts to zero and leaves unbound clips alone', () => {
		const unbound = narrationClip('n0', 250, 300);
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			unbound,
			narrationClip(
				'n1',
				900,
				2000,
				createTimelineBinding('animation-a', 'before-animation', -200),
			),
		]);
		const next = applyNarrationBindings(timeline);
		const clips = next.tracks[1].clips;
		expect(clips.find((clip) => clip.id === 'n0')).toBe(unbound);
		expect(clips.find((clip) => clip.id === 'n1')?.startMs).toBe(0);
	});

	it('keeps animation tracks untouched even when clips carry bindings', () => {
		const anchored = {
			...animationClip('animation-a', 1000, 500),
			binding: createTimelineBinding('animation-a', 'with-animation'),
		};
		const timeline = buildTimeline([anchored, narrationClip('n1', 0, 100)]);
		const next = applyNarrationBindings(timeline);
		expect(findAnimationAnchorClip(next, 'animation-a')).toBe(anchored);
	});

	it('ignores a non-finite offset instead of poisoning durationMs with NaN', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip(
				'n1',
				0,
				400,
				createTimelineBinding('animation-a', 'with-animation', Number.NaN),
			),
		]);
		const next = applyNarrationBindings(timeline);
		expect(next).toBe(timeline);
		expect(next.tracks[1].clips[0].startMs).toBe(0);
		expect(next.durationMs).toBe(1500);
		expect(Number.isFinite(next.durationMs)).toBeTruthy();
	});
});

describe('rebindTimelineClip', () => {
	const timeline = buildTimeline([
		animationClip('animation-a', 1000, 500),
		narrationClip('n1', 0, 400),
	]);

	it('rejects clips outside the narration track', () => {
		const visual = buildTimeline([
			{ id: 'v1', trackId: 'track-visual', kind: 'visual', startMs: 0, durationMs: 400 },
		]);
		const result = rebindTimelineClip(
			visual,
			'v1',
			createTimelineBinding('animation-a', 'with-animation'),
		);
		expect(result.accepted).toBeFalsy();
		expect(result.timeline).toBe(visual);
	});

	it('rejects a missing anchor without mutating the timeline', () => {
		const result = rebindTimelineClip(
			timeline,
			'n1',
			createTimelineBinding('animation-x', 'with-animation'),
		);
		expect(result.accepted).toBeFalsy();
		expect(result.timeline).toBe(timeline);
	});

	it('rejects a non-finite offset so NaN never reaches startMs', () => {
		const result = rebindTimelineClip(
			timeline,
			'n1',
			createTimelineBinding('animation-a', 'with-animation', Number.NaN),
		);
		expect(result.accepted).toBeFalsy();
		expect(result.timeline).toBe(timeline);
	});

	it('sets the binding and resolves startMs on success', () => {
		const binding = createTimelineBinding('animation-a', 'after-animation', 250);
		const result = rebindTimelineClip(timeline, 'n1', binding);
		expect(result.accepted).toBeTruthy();
		expect(result.clipIds).toStrictEqual(['n1']);
		expect(result.timeline.tracks[1].clips[0]).toMatchObject({
			startMs: 1750,
			binding,
		});
	});

	it('accepts a non-finite anchor startMs but keeps the current finite startMs', () => {
		const nanAnchorTimeline = buildTimeline([
			animationClip('animation-bad', Number.NaN, 500),
			narrationClip('n1', 750, 400),
		]);
		const result = rebindTimelineClip(
			nanAnchorTimeline,
			'n1',
			createTimelineBinding('animation-bad', 'with-animation'),
		);
		expect(result.accepted).toBeTruthy();
		const clip = result.timeline.tracks[1].clips.find((entry) => entry.id === 'n1');
		expect(clip?.binding?.anchorId).toBe('animation-bad');
		expect(clip?.startMs).toBe(750);
		expect(Number.isFinite(clip!.startMs)).toBeTruthy();
	});
});

describe('detachTimelineBinding', () => {
	it('clears the binding and keeps the current startMs', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip('n1', 1200, 400, createTimelineBinding('animation-a', 'with-animation', 200)),
		]);
		const result = detachTimelineBinding(timeline, 'n1');
		expect(result.accepted).toBeTruthy();
		const clip = result.timeline.tracks[1].clips[0];
		expect(clip.startMs).toBe(1200);
		expect(clip.binding).toBeUndefined();
		expect(result.timeline.tracks[1].clips[0]).not.toHaveProperty('binding');
	});

	it('rejects unknown clips', () => {
		const timeline = buildTimeline([narrationClip('n1', 0, 400)]);
		expect(detachTimelineBinding(timeline, 'missing').accepted).toBeFalsy();
	});
});

describe('moveNarrationClipFreely', () => {
	it('detaches a bound clip and places it at the proposed time', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip('n1', 0, 1000, createTimelineBinding('animation-a', 'with-animation')),
			narrationClip('n2', 3000, 1000),
		]);
		const result = moveNarrationClipFreely(timeline, 'n1', 2500);
		expect(result.accepted).toBeTruthy();
		const clip = result.timeline.tracks[1].clips.find((entry) => entry.id === 'n1');
		expect(clip).toMatchObject({ startMs: 2500 });
		expect(clip).not.toHaveProperty('binding');
	});

	it('passes unbound clips straight to the move', () => {
		const timeline = buildTimeline([narrationClip('n1', 0, 400)]);
		const result = moveNarrationClipFreely(timeline, 'n1', 800);
		expect(result.accepted).toBeTruthy();
		expect(result.timeline.tracks[1].clips[0].startMs).toBe(800);
	});

	it('keeps the original timeline when the move is rejected', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			{
				...narrationClip('n1', 0, 400, createTimelineBinding('animation-a', 'with-animation')),
				trackId: 'track-locked',
			},
		]);
		const locked = createTimelineModel([
			{ ...timeline.tracks[1], locked: true },
			timeline.tracks[0],
		]);
		const result = moveNarrationClipFreely(locked, 'n1', 2000);
		expect(result.accepted).toBeFalsy();
		expect(result.timeline).toBe(locked);
	});

	it('rejects moving a clip whose binding is locked, keeping the binding attached', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip(
				'n1',
				1000,
				400,
				createTimelineBinding('animation-a', 'with-animation', 0, true),
			),
		]);
		const result = moveNarrationClipFreely(timeline, 'n1', 4000);
		expect(result.accepted).toBeFalsy();
		expect(result.timeline).toBe(timeline);
		expect(result.timeline.tracks[1].clips[0].binding?.locked).toBeTruthy();
	});
});

describe('findNearestAnimationAnchor', () => {
	const timeline = buildTimeline([
		animationClip('animation-a', 1000, 500),
		animationClip('animation-b', 5000, 500),
	]);

	it('finds the closest anchor', () => {
		expect(findNearestAnimationAnchor(timeline, 1200)).toStrictEqual({
			anchorId: 'animation-a',
			anchorStartMs: 1000,
			distanceMs: 200,
		});
	});

	it('honours excludeClipId', () => {
		expect(
			findNearestAnimationAnchor(timeline, 1200, { excludeClipId: 'animation-a' })?.anchorId,
		).toBe('animation-b');
	});

	it('enforces maxDistanceMs including the exact boundary', () => {
		expect(findNearestAnimationAnchor(timeline, 3000, { maxDistanceMs: 1500 })).toBeUndefined();
		expect(findNearestAnimationAnchor(timeline, 3000, { maxDistanceMs: 2000 })?.anchorId).toBe(
			'animation-a',
		);
	});
});

describe('validateNarrationBindings', () => {
	it('reports one error per invalid scenario', () => {
		const visualWithBinding = {
			...animationClip('animation-a', 1000, 500),
			binding: createTimelineBinding('animation-a', 'with-animation'),
		};
		const invalid = buildTimeline([
			visualWithBinding,
			narrationClip('n1', 0, 400, createTimelineBinding('animation-missing', 'with-animation')),
			narrationClip(
				'n2',
				0,
				400,
				createTimelineBinding('animation-a', 'with-animation', Number.NaN),
			),
			narrationClip(
				'n3',
				0,
				400,
				createTimelineBinding('animation-a', 'with-animation', Number.POSITIVE_INFINITY),
			),
		]);
		const errors = validateNarrationBindings(invalid);
		expect(errors).toHaveLength(4);
		expect(errors[0]).toContain('animation track');
		expect(errors[1]).toContain('missing animation anchor');
		expect(errors[1]).toContain('animation-missing');
		expect(errors[2]).toContain('invalid binding offsetMs');
		expect(errors[3]).toContain('invalid binding offsetMs');
	});

	it('accepts a fully valid timeline', () => {
		const timeline = buildTimeline([
			animationClip('animation-a', 1000, 500),
			narrationClip('n1', 1000, 400, createTimelineBinding('animation-a', 'with-animation')),
		]);
		expect(validateNarrationBindings(timeline)).toStrictEqual([]);
	});
});

describe('binding labels and badges', () => {
	it('maps each mode to a Chinese label', () => {
		expect(describeTimelineBinding('before-animation')).toBe('动画前');
		expect(describeTimelineBinding('with-animation')).toBe('动画同时');
		expect(describeTimelineBinding('after-animation')).toBe('动画后');
	});

	it('formats badge text for positive, negative, and zero offsets', () => {
		expect(
			bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', 300), 'A12'),
		).toBe('🔗 A12 +0.3s');
		expect(
			bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', -200), 'A12'),
		).toBe('🔗 A12 -0.2s');
		expect(bindingBadgeText(createTimelineBinding('animation-a', 'with-animation'), 'A12')).toBe(
			'🔗 A12',
		);
	});

	it('uses whole seconds and millisecond formatting instead of long decimals', () => {
		expect(
			bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', 2000), 'A1'),
		).toBe('🔗 A1 +2s');
		expect(
			bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', -1500), 'A1'),
		).toBe('🔗 A1 -1.5s');
		expect(bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', 33), 'A1')).toBe(
			'🔗 A1 +33ms',
		);
	});

	it('falls back to the offset alone without an anchor label', () => {
		expect(bindingBadgeText(createTimelineBinding('animation-a', 'with-animation', 300), '')).toBe(
			'+0.3s',
		);
		expect(bindingBadgeText(createTimelineBinding('animation-a', 'with-animation'), '')).toBe('');
	});
});
