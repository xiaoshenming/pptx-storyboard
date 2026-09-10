import type { PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import {
	buildStoryboardShots,
	formatStoryboardTime,
	storyboardDuration,
	storyboardSlideForShot,
} from './storyboard-model';

function slide(overrides: Partial<PptxSlide> = {}): PptxSlide {
	return {
		id: 'slide-1',
		rId: 'rId1',
		slideNumber: 1,
		elements: [{ id: 'text-1', type: 'text', text: '勾股定理' } as PptxSlide['elements'][number]],
		...overrides,
	};
}

describe('buildStoryboardShots', () => {
	it('creates one static shot for a slide without animations', () => {
		const shots = buildStoryboardShots([slide({ notes: '介绍勾股定理。' })]);
		expect(shots).toHaveLength(1);
		expect(shots[0]).toMatchObject({ kind: 'static', script: '介绍勾股定理。' });
	});

	it('splits an animated slide into an initial shot and animation shots', () => {
		const shots = buildStoryboardShots([
			slide({ animations: [{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 800 }] }),
		]);
		expect(shots).toHaveLength(2);
		expect(shots.map((shot) => shot.kind)).toStrictEqual(['initial', 'animation']);
		expect(shots[1]).toMatchObject({ animationIndex: 0, effectLabel: 'fadeIn', durationMs: 1800 });
	});

	it('uses parsed native animations when editor animations are absent', () => {
		const animatedSlide = slide({
			nativeAnimations: [{ targetId: 'text-1', presetClass: 'entr', durationMs: 1500 }],
		});
		const shots = buildStoryboardShots([animatedSlide]);
		expect(shots).toHaveLength(2);
		expect(storyboardSlideForShot(animatedSlide, shots[0]).elements).toHaveLength(0);
		expect(storyboardSlideForShot(animatedSlide, shots[1]).elements).toHaveLength(1);
	});

	it('keeps with-previous and after-previous effects in one click group', () => {
		const shots = buildStoryboardShots([
			slide({
				animations: [
					{ elementId: 'one', entrance: 'fadeIn', durationMs: 800, trigger: 'onClick' },
					{ elementId: 'two', entrance: 'fadeIn', durationMs: 500, trigger: 'withPrevious' },
					{ elementId: 'three', entrance: 'fadeIn', durationMs: 600, trigger: 'afterPrevious' },
				],
			}),
		]);
		expect(shots).toHaveLength(2);
		expect(shots[1].animationIndices).toStrictEqual([0, 1, 2]);
		expect(shots[1].animationEvents?.map((event) => event.startOffsetMs)).toStrictEqual([
			0, 0, 500,
		]);
		expect(shots[1].script).toBe('');
	});

	it('uses native parGroupIndex as the parallel grouping key', () => {
		const shots = buildStoryboardShots([
			slide({
				nativeAnimations: [
					{ targetId: 'one', presetClass: 'entr', durationMs: 700, parGroupIndex: 4 },
					{ targetId: 'two', presetClass: 'emph', durationMs: 900, parGroupIndex: 4 },
				],
			}),
		]);
		expect(shots).toHaveLength(2);
		expect(shots[1]).toMatchObject({ animationIndices: [0, 1], durationMs: 1900 });
	});

	it('collapses animated slides to one shot in static fast mode', () => {
		const shots = buildStoryboardShots(
			[slide({ nativeAnimations: [{ targetId: 'text-1', presetClass: 'entr' }] })],
			{ collapseAnimations: true },
		);
		expect(shots).toHaveLength(1);
		expect(shots[0].kind).toBe('static');
	});
});

describe('storyboard timing', () => {
	it('totals and formats shot durations', () => {
		const shots = buildStoryboardShots([slide(), slide({ id: 'slide-2', slideNumber: 2 })]);
		expect(storyboardDuration(shots)).toBe(10_000);
		expect(formatStoryboardTime(storyboardDuration(shots))).toBe('0:10');
	});
});
