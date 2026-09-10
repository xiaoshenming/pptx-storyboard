import { describe, expect, it } from 'vitest';

import {
	createTimelineModel,
	createTimelineTrack,
	findTimelineClip,
	moveTimelineClip,
	placeClipOnTrack,
	resizeTimelineClip,
} from './index';
import type { TimelineClip } from './index';

function clip(id: string, startMs: number, durationMs: number): TimelineClip {
	return { id, trackId: 'track-visual', kind: 'visual', startMs, durationMs };
}

describe('clip collision strategies', () => {
	it('treats touching clip edges as non-overlapping', () => {
		const track = createTimelineTrack('visual', [clip('a', 0, 1000)]);
		const result = placeClipOnTrack(track, clip('b', 1000, 500), 'reject');
		expect(result.accepted).toBeTruthy();
	});

	it('rejects a collision without mutating the track', () => {
		const track = createTimelineTrack('visual', [clip('a', 0, 1000)]);
		const result = placeClipOnTrack(track, clip('b', 500, 500), 'reject');
		expect(result.accepted).toBeFalsy();
		expect(result.track).toBe(track);
		expect(result.collisionIds).toStrictEqual(['a']);
	});

	it('splits an overwritten clip around the new clip', () => {
		const track = createTimelineTrack('visual', [clip('a', 0, 3000)]);
		const result = placeClipOnTrack(track, clip('b', 1000, 1000), 'overwrite');
		expect(result.track.clips).toStrictEqual([
			clip('a', 0, 1000),
			clip('b', 1000, 1000),
			clip('a__after_b', 2000, 1000),
		]);
	});

	it('ripples colliding and following clips while preserving gaps', () => {
		const track = createTimelineTrack('visual', [clip('a', 0, 1000), clip('b', 1500, 500)]);
		const result = placeClipOnTrack(track, clip('insert', 500, 750), 'ripple');
		expect(result.track.clips.map(({ id, startMs }) => [id, startMs])).toStrictEqual([
			['insert', 500],
			['a', 1250],
			['b', 2750],
		]);
	});
});

describe('timeline drag and resize', () => {
	it('moves parallel animation clips together', () => {
		const animations = createTimelineTrack('animation', [
			{
				id: 'a',
				trackId: 'track-animation',
				kind: 'animation',
				startMs: 1000,
				durationMs: 500,
				parallelGroupId: 'group-1',
			},
			{
				id: 'b',
				trackId: 'track-animation',
				kind: 'animation',
				startMs: 1200,
				durationMs: 800,
				parallelGroupId: 'group-1',
			},
		]);
		const result = moveTimelineClip(createTimelineModel([animations]), 'a', 2000);
		expect(result.accepted).toBeTruthy();
		expect(result.clipIds).toStrictEqual(['a', 'b']);
		expect(findTimelineClip(result.timeline, 'a')?.clip.startMs).toBe(2000);
		expect(findTimelineClip(result.timeline, 'b')?.clip.startMs).toBe(2200);
	});

	it('snaps a move to a neighbouring edge', () => {
		const timeline = createTimelineModel([
			createTimelineTrack('visual', [clip('a', 0, 1000), clip('b', 2000, 500)]),
		]);
		const result = moveTimelineClip(timeline, 'b', 1040, {
			snap: { pixelsPerSecond: 100, thresholdPx: 5 },
		});
		expect(result.accepted).toBeTruthy();
		expect(findTimelineClip(result.timeline, 'b')?.clip.startMs).toBe(1000);
	});

	it('resizes either edge and enforces a minimum duration', () => {
		const timeline = createTimelineModel([createTimelineTrack('visual', [clip('a', 1000, 1000)])]);
		const startResult = resizeTimelineClip(timeline, 'a', 'start', 1800, {
			minimumDurationMs: 500,
		});
		expect(findTimelineClip(startResult.timeline, 'a')?.clip).toMatchObject({
			startMs: 1500,
			durationMs: 500,
		});
		const endResult = resizeTimelineClip(timeline, 'a', 'end', 1200, {
			minimumDurationMs: 400,
		});
		expect(findTimelineClip(endResult.timeline, 'a')?.clip.durationMs).toBe(400);
	});
});
