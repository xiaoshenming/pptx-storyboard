import { describe, expect, it } from 'vitest';

import { clipEndMs, sortClips } from './model';
import type { TimelineClip } from './types';

function clip(id: string, startMs: number, durationMs = 500): TimelineClip {
	return { id, trackId: 'track-animation', kind: 'animation', startMs, durationMs };
}

describe('sortClips', () => {
	it('orders clips by startMs first', () => {
		const sorted = sortClips([clip('a', 2000), clip('b', 1000), clip('c', 3000)]);
		expect(sorted.map((entry) => entry.id)).toStrictEqual(['b', 'a', 'c']);
	});

	it('breaks startMs ties by code-point id order, not locale collation', () => {
		// Code-point order puts 'animation-10' before 'animation-2' ('1' < '2'),
		// while localeCompare with explicit ICU numeric folding sorts '2'
		// before '10'. Anchor numbering and "earliest anchor" picks must stay
		// deterministic across environments, so code-point order is the contract.
		const two = clip('animation-2', 1000);
		const ten = clip('animation-10', 1000);
		expect(two.id.localeCompare(ten.id, 'en', { numeric: true })).toBeLessThan(0);
		const sorted = sortClips([two, ten]);
		expect(sorted.map((entry) => entry.id)).toStrictEqual(['animation-10', 'animation-2']);
	});

	it('returns a new array and keeps the input order untouched', () => {
		const input = [clip('b', 1000), clip('a', 1000)];
		const sorted = sortClips(input);
		expect(sorted).not.toBe(input);
		expect(input.map((entry) => entry.id)).toStrictEqual(['b', 'a']);
		expect(sorted.map((entry) => entry.id)).toStrictEqual(['a', 'b']);
	});
});

describe('clipEndMs', () => {
	it('adds start and duration', () => {
		expect(clipEndMs(clip('a', 1200, 300))).toBe(1500);
	});
});
