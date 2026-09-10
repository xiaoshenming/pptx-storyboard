import { describe, expect, it } from 'vitest';

import { createTimelineModel, createTimelineTrack } from './model';
import {
	clampPlayhead,
	computePlayheadState,
	findNextBoundaryMs,
	stepPlayhead,
	stepPlayheadFrames,
} from './playhead';
import { DEFAULT_FRAME_RATE } from './time';
import type { TimelineClip, TimelineModel, TimelineTrackKind } from './types';

function clip(
	kind: TimelineTrackKind,
	id: string,
	startMs: number,
	durationMs: number,
): TimelineClip {
	return { id, trackId: `track-${kind}`, kind, startMs, durationMs };
}

function buildTimeline(): TimelineModel {
	return createTimelineModel([
		createTimelineTrack('visual', [clip('visual', 'v1', 0, 1000), clip('visual', 'v2', 1000, 500)]),
		createTimelineTrack('narration', [clip('narration', 'n1', 200, 1100)]),
		createTimelineTrack('subtitle'),
	]);
}

function buildEmptyTimeline(): TimelineModel {
	return createTimelineModel([createTimelineTrack('visual')]);
}

describe('clampPlayhead', () => {
	it('keeps values inside [0, durationMs]', () => {
		const timeline = buildTimeline();
		expect(clampPlayhead(timeline, 750)).toBe(750);
	});

	it('returns 0 for a zero-duration timeline', () => {
		expect(clampPlayhead(buildEmptyTimeline(), 500)).toBe(0);
	});

	it('clamps negative values to 0', () => {
		expect(clampPlayhead(buildTimeline(), -100)).toBe(0);
	});

	it('falls back to 0 for non-finite values', () => {
		const timeline = buildTimeline();
		expect(clampPlayhead(timeline, Number.NaN)).toBe(0);
		expect(clampPlayhead(timeline, Number.POSITIVE_INFINITY)).toBe(0);
		expect(clampPlayhead(timeline, Number.NEGATIVE_INFINITY)).toBe(0);
	});

	it('clamps to durationMs at the upper end', () => {
		expect(clampPlayhead(buildTimeline(), 99_999)).toBe(1500);
	});
});

describe('computePlayheadState', () => {
	it('hits a clip exactly at startMs but not at its end', () => {
		const timeline = buildTimeline();
		const atStart = computePlayheadState(timeline, 1000);
		expect(atStart.playheadMs).toBe(1000);
		expect(atStart.activeClips.map(({ id }) => id)).toStrictEqual(['n1', 'v2']);
		expect(atStart.currentClipIdByTrack).toStrictEqual({
			'track-visual': 'v2',
			'track-narration': 'n1',
			'track-subtitle': undefined,
		});

		const atNarrationEnd = computePlayheadState(timeline, 1300);
		expect(atNarrationEnd.activeClips.map(({ id }) => id)).toStrictEqual(['v2']);
		expect(atNarrationEnd.currentClipIdByTrack['track-narration']).toBeUndefined();
	});

	it('orders activeClips by startMs ascending', () => {
		const state = computePlayheadState(buildTimeline(), 500);
		expect(state.activeClips.map(({ id }) => id)).toStrictEqual(['v1', 'n1']);
	});

	it('keeps at most one current clip per track and picks the earliest', () => {
		const timeline = createTimelineModel([
			createTimelineTrack('animation', [
				clip('animation', 'a1', 500, 500),
				clip('animation', 'a2', 700, 500),
			]),
		]);
		const state = computePlayheadState(timeline, 800);
		expect(state.activeClips.map(({ id }) => id)).toStrictEqual(['a1', 'a2']);
		expect(state.currentClipIdByTrack['track-animation']).toBe('a1');
	});

	it('reports undefined for tracks without an active clip', () => {
		const state = computePlayheadState(buildTimeline(), 1400);
		expect(state.activeClips.map(({ id }) => id)).toStrictEqual(['v2']);
		expect(state.currentClipIdByTrack['track-narration']).toBeUndefined();
		expect(state.currentClipIdByTrack['track-subtitle']).toBeUndefined();
	});

	it('clamps an out-of-range playhead before matching', () => {
		const timeline = buildTimeline();
		const beyond = computePlayheadState(timeline, 99_999);
		expect(beyond.playheadMs).toBe(1500);
		expect(beyond.activeClips).toStrictEqual([]);

		const before = computePlayheadState(timeline, -5);
		expect(before.playheadMs).toBe(0);
		expect(before.activeClips.map(({ id }) => id)).toStrictEqual(['v1']);
	});

	it('returns an empty state for a zero-duration timeline', () => {
		const state = computePlayheadState(buildEmptyTimeline(), 100);
		expect(state.playheadMs).toBe(0);
		expect(state.activeClips).toStrictEqual([]);
		expect(state.currentClipIdByTrack).toStrictEqual({ 'track-visual': undefined });
	});
});

describe('stepPlayhead', () => {
	const timeline = buildTimeline();

	it('steps forward and backward', () => {
		expect(stepPlayhead(timeline, 0, 400)).toBe(400);
		expect(stepPlayhead(timeline, 1000, -300)).toBe(700);
	});

	it('clamps to both ends', () => {
		expect(stepPlayhead(timeline, 1400, 500)).toBe(1500);
		expect(stepPlayhead(timeline, 100, -500)).toBe(0);
	});

	it('falls back to 0 for a non-finite delta', () => {
		expect(stepPlayhead(timeline, 500, Number.NaN)).toBe(0);
	});
});

describe('stepPlayheadFrames', () => {
	const timeline = buildTimeline();

	it('steps one frame forward at 30fps to the quantized frame duration', () => {
		expect(stepPlayheadFrames(timeline, 0, 1, 30)).toBeCloseTo(1000 / 30, 9);
		expect(DEFAULT_FRAME_RATE).toBe(30);
	});

	it('defaults to DEFAULT_FRAME_RATE', () => {
		expect(stepPlayheadFrames(timeline, 0, 3)).toBeCloseTo(100, 9);
	});

	it('steps negative frames and quantizes the result', () => {
		expect(stepPlayheadFrames(timeline, 500, -3, 30)).toBeCloseTo(400, 9);
		expect(stepPlayheadFrames(timeline, 100, 1, 30)).toBeCloseTo(4000 / 30, 9);
	});

	it('clamps quantized results to both ends', () => {
		expect(stepPlayheadFrames(timeline, 1490, 3, 30)).toBe(1500);
		expect(stepPlayheadFrames(timeline, 10, -1, 30)).toBe(0);
	});
});

describe('findNextBoundaryMs', () => {
	const timeline = buildTimeline();

	it('finds the nearest clip start forwards', () => {
		expect(findNextBoundaryMs(timeline, 0, 1)).toBe(200);
		expect(findNextBoundaryMs(timeline, 250, 1)).toBe(1000);
	});

	it('finds the nearest clip end forwards', () => {
		expect(findNextBoundaryMs(timeline, 1050, 1)).toBe(1300);
	});

	it('finds the nearest boundary backwards', () => {
		expect(findNextBoundaryMs(timeline, 1500, -1)).toBe(1300);
		expect(findNextBoundaryMs(timeline, 1250, -1)).toBe(1000);
		expect(findNextBoundaryMs(timeline, 500, -1)).toBe(200);
	});

	it('compares strictly so a boundary at the playhead is skipped', () => {
		expect(findNextBoundaryMs(timeline, 1000, 1)).toBe(1300);
		expect(findNextBoundaryMs(timeline, 1000, -1)).toBe(200);
	});

	it('excludes 0 and durationMs as boundaries', () => {
		expect(findNextBoundaryMs(timeline, -100, 1)).toBe(200);
		expect(findNextBoundaryMs(timeline, 2000, -1)).toBe(1300);
	});

	it('returns undefined when no boundary lies ahead', () => {
		expect(findNextBoundaryMs(timeline, 1499, 1)).toBeUndefined();
		expect(findNextBoundaryMs(timeline, 1, -1)).toBeUndefined();
	});

	it('returns undefined for a timeline without clips', () => {
		const empty = buildEmptyTimeline();
		expect(findNextBoundaryMs(empty, 0, 1)).toBeUndefined();
		expect(findNextBoundaryMs(empty, 0, -1)).toBeUndefined();
	});
});
