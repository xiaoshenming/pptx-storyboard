// @vitest-environment happy-dom
/**
 * Tests for animation group brackets: bucketing (same group + same startMs),
 * bracket geometry, the N=1 suppression, and the React key derivation that
 * keeps same-start groups from colliding (and dropping each other).
 *
 * Rendering uses the manual createRoot + act harness (no @testing-library).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	AnimationGroupBrackets,
	animationBracketKey,
	animationGroupBrackets,
} from './animation-group-brackets';
import { createTimelineTrack } from './timeline';
import type { TimelineClip, TimelineTrack } from './timeline';

const PPS = 80;
const px = (ms: number): number => (ms / 1000) * PPS;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function groupedClip(id: string, startMs: number, durationMs: number, group: string): TimelineClip {
	return {
		id,
		trackId: 'track-animation',
		kind: 'animation',
		startMs,
		durationMs,
		parallelGroupId: group,
	};
}

function animationTrack(clips: TimelineClip[]): TimelineTrack {
	return createTimelineTrack('animation', clips);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function renderBrackets(track: TimelineTrack): void {
	act(() => {
		root.render(<AnimationGroupBrackets brackets={animationGroupBrackets(track, PPS)} />);
	});
}

describe('animationGroupBrackets bucketing', () => {
	it('buckets clips of one group sharing a startMs into a single bracket', () => {
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'g1'),
			groupedClip('a2', 2000, 800, 'g1'),
		]);
		const brackets = animationGroupBrackets(track, PPS);
		expect(brackets).toHaveLength(1);
		expect(brackets[0].groupId).toBe('g1');
		expect(brackets[0].clipIds).toStrictEqual(['a1', 'a2']);
		expect(brackets[0].label).toBe('同时播放 2 个动画');
	});

	it('does not merge clips of one group with different start times', () => {
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'g1'),
			groupedClip('a2', 3000, 800, 'g1'),
		]);
		// Each bucket holds a single clip, so no bracket is drawn at all.
		expect(animationGroupBrackets(track, PPS)).toStrictEqual([]);
	});

	it('draws no bracket for a single-clip group or ungrouped clips', () => {
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'solo'),
			groupedClip('a2', 2000, 800, 'other'),
			{ id: 'a3', trackId: 'track-animation', kind: 'animation', startMs: 2000, durationMs: 800 },
		]);
		expect(animationGroupBrackets(track, PPS)).toStrictEqual([]);
	});

	it('spans the bracket from the earliest start to the latest end', () => {
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'g1'),
			groupedClip('a2', 2000, 1200, 'g1'),
		]);
		const brackets = animationGroupBrackets(track, PPS);
		expect(brackets).toHaveLength(1);
		// a2's longer duration ends latest: 2000ms..3200ms at 80 px/s.
		expect(brackets[0].leftPx).toBe(px(2000));
		expect(brackets[0].widthPx).toBe(px(3200) - px(2000));
	});

	it('returns nothing for non-animation tracks or non-positive zoom', () => {
		const visualTrack = createTimelineTrack('visual', [
			groupedClip('v1', 2000, 800, 'g1'),
			groupedClip('v2', 2000, 800, 'g1'),
		]);
		expect(animationGroupBrackets(visualTrack, PPS)).toStrictEqual([]);
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'g1'),
			groupedClip('a2', 2000, 800, 'g1'),
		]);
		expect(animationGroupBrackets(track, 0)).toStrictEqual([]);
	});
});

describe('animationBracketKey', () => {
	it('stays distinct when two brackets share groupId and leftPx', () => {
		// Regression guard for the dropped-bracket key collision: the lead clip
		// id disambiguates brackets that geometry and group alone cannot.
		const first = { groupId: 'g1', clipIds: ['a1', 'a2'], label: '', leftPx: 160, widthPx: 64 };
		const second = { groupId: 'g1', clipIds: ['b1', 'b2'], label: '', leftPx: 160, widthPx: 64 };
		expect(animationBracketKey(first)).not.toBe(animationBracketKey(second));
		expect(animationBracketKey(first)).toContain('a1');
	});
});

describe('animationGroupBrackets rendering', () => {
	it('keeps both same-start groups visible instead of squeezing one out', () => {
		const track = animationTrack([
			groupedClip('a1', 2000, 800, 'gA'),
			groupedClip('a2', 2000, 800, 'gA'),
			groupedClip('b1', 2000, 800, 'gB'),
			groupedClip('b2', 2000, 800, 'gB'),
		]);
		renderBrackets(track);
		const nodes = Array.from(container.querySelectorAll('[data-group-bracket]'));
		expect(nodes).toHaveLength(2);
		const clipIdSets = nodes.map((node) => node.getAttribute('data-group-clip-ids'));
		expect(clipIdSets).toContain('a1,a2');
		expect(clipIdSets).toContain('b1,b2');
	});
});
