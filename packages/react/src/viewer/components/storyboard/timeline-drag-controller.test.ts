/**
 * Pure-function tests for the timeline drag controller: the moved latch, the
 * P1 sub-threshold frame gate, narration move frames (magnet/grid/detach
 * first), release decisions (rebind / free detach / unmoved restore), and the
 * pointercancel rollback. No component mount: every input is constructed.
 */
import { describe, expect, it } from 'vitest';

import {
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
	findTimelineClip,
} from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';
import {
	beginTimelineDrag,
	clipAfterEdit,
	dragPassedMoveThreshold,
	planMoveFrame,
	planNarrationMoveFrame,
	planResizeFrame,
	resolveNarrationRelease,
	rollbackNarrationDrag,
	withDragClientX,
} from './timeline-drag-controller';

// 80 px/s keeps the maths in whole pixels: 1px = 12.5ms, 8px magnet = 100ms.
const PPS = 80;
const px = (ms: number): number => (ms / 1000) * PPS;

function animationClip(id: string, startMs: number, durationMs = 800): TimelineClip {
	return { id, trackId: 'track-animation', kind: 'animation', startMs, durationMs };
}

function visualClip(id: string, startMs: number, durationMs: number): TimelineClip {
	return { id, trackId: 'track-visual', kind: 'visual', startMs, durationMs };
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
			'visual',
			clips.filter((clip) => clip.kind === 'visual'),
		),
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

function narrationOf(timeline: TimelineModel, clipId = 'narr-1'): TimelineClip {
	return findTimelineClip(timeline, clipId)!.clip;
}

describe('moved latch (withDragClientX + dragPassedMoveThreshold)', () => {
	it('latches only past the 3px threshold and stays latched near the origin', () => {
		const drag = beginTimelineDrag(narrationClip('narr-1', 0, 1000), 'move', 100);
		expect(drag.moved).toBeFalsy();
		expect(withDragClientX(drag, 103).moved).toBeFalsy();
		const moved = withDragClientX(drag, 104);
		expect(moved.moved).toBeTruthy();
		// Pointer came back across the origin: a drag never degrades to a click.
		expect(withDragClientX(moved, 100).moved).toBeTruthy();
	});

	it('dragPassedMoveThreshold mirrors the latch without mutating the drag', () => {
		const drag = beginTimelineDrag(narrationClip('narr-1', 0, 1000), 'move', 100);
		expect(dragPassedMoveThreshold(drag, 103)).toBeFalsy();
		expect(dragPassedMoveThreshold(drag, 104)).toBeTruthy();
		expect(drag.moved).toBeFalsy();
		expect(dragPassedMoveThreshold(withDragClientX(drag, 104), 100)).toBeTruthy();
	});
});

describe('planNarrationMoveFrame', () => {
	// The bound narration lives in the model, so every frame proves the
	// detach-first intermediate: the committed model strips the binding.
	const origin = createTimelineBinding('anim-1', 'with-animation', 3000);
	const timeline = buildTimeline([
		animationClip('anim-1', 5000),
		narrationClip('narr-1', 8000, 1500, origin),
	]);

	function dragFrom(clientX: number) {
		return beginTimelineDrag(narrationClip('narr-1', 8000, 1500, origin), 'move', clientX);
	}

	it('gates sub-threshold pointer travel to zero frames (P1)', () => {
		const drag = dragFrom(px(8000));
		expect(
			planNarrationMoveFrame({ timeline, drag, clientX: px(8000) + 2, pixelsPerSecond: PPS }),
		).toBeUndefined();
		// Exactly at the threshold is still a wiggle; one pixel beyond commits.
		expect(
			planNarrationMoveFrame({ timeline, drag, clientX: px(8000) + 3, pixelsPerSecond: PPS }),
		).toBeUndefined();
		const frame = planNarrationMoveFrame({
			timeline,
			drag,
			clientX: px(8000) + 4,
			pixelsPerSecond: PPS,
		});
		expect(frame).toBeDefined();
	});

	it('snaps onto a magnet anchor and strips the binding in the intermediate state', () => {
		const drag = dragFrom(px(8000));
		const frame = planNarrationMoveFrame({
			timeline,
			drag,
			clientX: px(5000),
			pixelsPerSecond: PPS,
		});
		expect(frame?.magnetAnchorId).toBe('anim-1');
		expect(frame?.result.accepted).toBeTruthy();
		const clip = narrationOf(frame!.result.timeline);
		expect(clip.startMs).toBe(5000);
		expect(clip).not.toHaveProperty('binding');
		// clipAfterEdit feeds the committed snapshot into the next drag frame.
		expect(clipAfterEdit(frame!.result, 'narr-1')?.startMs).toBe(5000);
	});

	it('falls back to grid snap beyond the magnet radius', () => {
		const drag = dragFrom(px(8000));
		const frame = planNarrationMoveFrame({
			timeline,
			drag,
			clientX: px(7000),
			pixelsPerSecond: PPS,
		});
		expect(frame?.magnetAnchorId).toBeNull();
		const clip = narrationOf(frame!.result.timeline);
		expect(clip.startMs).toBe(7000);
		expect(clip).not.toHaveProperty('binding');
	});
});

describe('planMoveFrame', () => {
	it('gates sub-threshold pointer travel to zero frames (P1)', () => {
		const timeline = buildTimeline([visualClip('vis-1', 0, 1000), visualClip('vis-2', 5000, 4000)]);
		const drag = beginTimelineDrag(visualClip('vis-1', 0, 1000), 'move', px(0));
		expect(planMoveFrame({ timeline, drag, clientX: 2, pixelsPerSecond: PPS })).toBeUndefined();
	});

	it('moves a visual clip with snap and ripple collisions past the threshold', () => {
		const timeline = buildTimeline([visualClip('vis-1', 0, 1000), visualClip('vis-2', 5000, 4000)]);
		const drag = beginTimelineDrag(visualClip('vis-1', 0, 1000), 'move', px(0));
		const result = planMoveFrame({ timeline, drag, clientX: px(2000), pixelsPerSecond: PPS });
		expect(result?.accepted).toBeTruthy();
		expect(findTimelineClip(result!.timeline, 'vis-1')?.clip.startMs).toBe(2000);
	});
});

describe('planResizeFrame', () => {
	const timeline = buildTimeline([animationClip('anim-1', 2000)]);

	it('gates sub-threshold pointer travel to zero frames (P1)', () => {
		const drag = beginTimelineDrag(animationClip('anim-1', 2000), 'resize-end', px(2800));
		expect(
			planResizeFrame({ timeline, drag, clientX: px(2800) + 3, pixelsPerSecond: PPS }),
		).toBeUndefined();
	});

	it('resizes the end edge past the threshold', () => {
		const drag = beginTimelineDrag(animationClip('anim-1', 2000), 'resize-end', px(2800));
		const result = planResizeFrame({
			timeline,
			drag,
			clientX: px(2800) + 40,
			pixelsPerSecond: PPS,
		});
		expect(result?.accepted).toBeTruthy();
		expect(findTimelineClip(result!.timeline, 'anim-1')?.clip.durationMs).toBe(1300);
	});
});

describe('resolveNarrationRelease', () => {
	it('rebinds to the magnet anchor with zero offset on a snapped release', () => {
		const timeline = buildTimeline([
			animationClip('anim-1', 5000),
			narrationClip('narr-1', 5000, 1500),
		]);
		let drag = beginTimelineDrag(
			narrationClip('narr-1', 8000, 1500, createTimelineBinding('anim-1', 'with-animation', 3000)),
			'move',
			px(8000),
		);
		drag = withDragClientX({ ...drag, clip: narrationOf(timeline) }, px(5000));
		const release = resolveNarrationRelease({ timeline, drag, pixelsPerSecond: PPS });
		expect(release.magnetAnchorId).toBe('anim-1');
		expect(release.result?.accepted).toBeTruthy();
		const clip = narrationOf(release.result!.timeline);
		expect(clip.binding).toStrictEqual(createTimelineBinding('anim-1', 'with-animation', 0));
		expect(clip.startMs).toBe(5000);
	});

	it('sends no onChange for a free landing whose detached state is already final', () => {
		const timeline = buildTimeline([
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 11000, 1500),
		]);
		let drag = beginTimelineDrag(
			narrationClip('narr-1', 2000, 1500, createTimelineBinding('anim-1', 'with-animation')),
			'move',
			px(2000),
		);
		drag = withDragClientX({ ...drag, clip: narrationOf(timeline) }, px(11000));
		const release = resolveNarrationRelease({ timeline, drag, pixelsPerSecond: PPS });
		expect(release.magnetAnchorId).toBeNull();
		expect(release.result).toBeUndefined();
	});

	it('moves the narration freely when the parent state lags the free landing', () => {
		const stale = buildTimeline([
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 9000, 1500),
		]);
		let drag = beginTimelineDrag(
			narrationClip('narr-1', 2000, 1500, createTimelineBinding('anim-1', 'with-animation')),
			'move',
			px(2000),
		);
		drag = withDragClientX({ ...drag, clip: narrationClip('narr-1', 11000, 1500) }, px(11000));
		const release = resolveNarrationRelease({ timeline: stale, drag, pixelsPerSecond: PPS });
		expect(release.magnetAnchorId).toBeNull();
		expect(release.result?.accepted).toBeTruthy();
		const clip = narrationOf(release.result!.timeline);
		expect(clip.startMs).toBe(11000);
		expect(clip.binding).toBeUndefined();
	});

	it('restores the origin binding when frames committed without reaching the threshold (P1)', () => {
		// Pathological state: the controlled parent adopted a detached frame even
		// though `moved` never latched. Release must rebind, not stay silent.
		const origin = createTimelineBinding('anim-1', 'with-animation', 3000);
		const timeline = buildTimeline([
			animationClip('anim-1', 5000),
			narrationClip('narr-1', 7600, 1500),
		]);
		const drag = beginTimelineDrag(narrationClip('narr-1', 8000, 1500, origin), 'move', px(8000));
		expect(drag.moved).toBeFalsy();
		const release = resolveNarrationRelease({ timeline, drag, pixelsPerSecond: PPS });
		expect(release.magnetAnchorId).toBe('anim-1');
		expect(release.result?.accepted).toBeTruthy();
		const clip = narrationOf(release.result!.timeline);
		expect(clip.binding).toStrictEqual(origin);
		expect(clip.startMs).toBe(8000);
	});

	it('sends no onChange for an unmoved drag whose bound state is intact', () => {
		const origin = createTimelineBinding('anim-1', 'with-animation', 3000);
		const timeline = buildTimeline([
			animationClip('anim-1', 5000),
			narrationClip('narr-1', 8000, 1500, origin),
		]);
		const drag = beginTimelineDrag(narrationOf(timeline), 'move', px(8000));
		const release = resolveNarrationRelease({ timeline, drag, pixelsPerSecond: PPS });
		expect(release.result).toBeUndefined();
		expect(release.magnetAnchorId).toBeNull();
	});

	it('ignores resize drags and non-narration clips', () => {
		const timeline = buildTimeline([animationClip('anim-1', 5000)]);
		const resize = beginTimelineDrag(
			narrationClip('narr-1', 8000, 1500, createTimelineBinding('anim-1', 'with-animation')),
			'resize-end',
			px(8000),
		);
		expect(
			resolveNarrationRelease({ timeline, drag: resize, pixelsPerSecond: PPS }).result,
		).toBeUndefined();
		const visual = beginTimelineDrag(visualClip('vis-1', 0, 1000), 'move', 0);
		expect(
			resolveNarrationRelease({ timeline, drag: visual, pixelsPerSecond: PPS }).result,
		).toBeUndefined();
	});
});

describe('rollbackNarrationDrag', () => {
	it('rebinds a bound narration to its origin on pointercancel', () => {
		const origin = createTimelineBinding('anim-1', 'with-animation', 3000);
		const timeline = buildTimeline([
			animationClip('anim-1', 5000),
			narrationClip('narr-1', 7300, 1500),
		]);
		const drag = beginTimelineDrag(narrationClip('narr-1', 8000, 1500, origin), 'move', px(8000));
		const rollback = rollbackNarrationDrag({ timeline, drag });
		expect(rollback?.accepted).toBeTruthy();
		const clip = narrationOf(rollback!.timeline);
		expect(clip.binding).toStrictEqual(origin);
		expect(clip.startMs).toBe(8000);
	});

	it('returns undefined without an origin binding, for resize drags and non-narration clips', () => {
		const timeline = buildTimeline([animationClip('anim-1', 5000)]);
		const free = beginTimelineDrag(narrationClip('narr-1', 8000, 1500), 'move', px(8000));
		expect(rollbackNarrationDrag({ timeline, drag: free })).toBeUndefined();
		const resize = beginTimelineDrag(
			narrationClip('narr-1', 8000, 1500, createTimelineBinding('anim-1', 'with-animation')),
			'resize-end',
			px(8000),
		);
		expect(rollbackNarrationDrag({ timeline, drag: resize })).toBeUndefined();
		const visual = beginTimelineDrag(visualClip('vis-1', 0, 1000), 'move', 0);
		expect(rollbackNarrationDrag({ timeline, drag: visual })).toBeUndefined();
	});
});
