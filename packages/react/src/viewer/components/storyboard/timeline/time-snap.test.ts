import { describe, expect, it } from 'vitest';

import {
	formatTimelineTime,
	frameToMilliseconds,
	millisecondsToFrame,
	millisecondsToPixels,
	pixelsToMilliseconds,
	snapClipStart,
	snapTime,
} from './index';

describe('timeline time conversion', () => {
	it('converts between milliseconds, pixels, and frames', () => {
		expect(millisecondsToPixels(2500, 120)).toBe(300);
		expect(pixelsToMilliseconds(300, 120)).toBe(2500);
		expect(millisecondsToFrame(1000, 25)).toBe(25);
		expect(frameToMilliseconds(25, 25)).toBe(1000);
		expect(formatTimelineTime(3_723_480, 25)).toBe('01:02:03:12');
	});

	it('returns safe values for invalid scales', () => {
		expect(millisecondsToPixels(1000, 0)).toBe(0);
		expect(pixelsToMilliseconds(100, 0)).toBe(0);
		expect(millisecondsToFrame(Number.NaN, 30)).toBe(0);
	});
});

describe('timeline snapping', () => {
	it('snaps to the nearest clip edge within a pixel threshold', () => {
		const result = snapTime(1960, {
			pixelsPerSecond: 100,
			thresholdPx: 5,
			points: [{ timeMs: 2000, type: 'clip-end', sourceId: 'clip-a' }],
		});
		expect(result).toStrictEqual({
			timeMs: 2000,
			deltaMs: 40,
			point: { timeMs: 2000, type: 'clip-end', sourceId: 'clip-a' },
		});
	});

	it('can snap a dragged clip by its trailing edge', () => {
		const result = snapClipStart(
			{ id: 'a', trackId: 'v', kind: 'visual', startMs: 0, durationMs: 1000 },
			2050,
			{
				pixelsPerSecond: 100,
				thresholdPx: 10,
				points: [{ timeMs: 3000, type: 'playhead' }],
			},
		);
		expect(result.timeMs).toBe(2000);
		expect(result.point?.type).toBe('playhead');
	});

	it('supports grid snapping and leaves distant values unchanged', () => {
		expect(snapTime(980, { pixelsPerSecond: 100, thresholdPx: 3, gridMs: 500 }).timeMs).toBe(1000);
		expect(snapTime(920, { pixelsPerSecond: 100, thresholdPx: 3, gridMs: 500 }).timeMs).toBe(920);
	});
});
