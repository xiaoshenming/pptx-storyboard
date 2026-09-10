import type { PptxSlide } from 'pptx-viewer-core';
import { describe, expect, it } from 'vitest';

import {
	buildStoryboardShots,
	formatStoryboardTime,
	retimeSilentStoryboardShots,
	storyboardDuration,
	storyboardSlideForShot,
} from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';

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
		expect(shots[1]).toMatchObject({
			animationIndex: 0,
			effectLabel: '进入动画',
			durationMs: 1800,
		});
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
					{
						targetId: 'one',
						presetClass: 'entr',
						durationMs: 700,
						parGroupIndex: 4,
						trigger: 'onClick',
					},
					{
						targetId: 'two',
						presetClass: 'emph',
						durationMs: 900,
						parGroupIndex: 4,
						trigger: 'withPrevious',
					},
				],
			}),
		]);
		expect(shots).toHaveLength(2);
		// Silent reveal group (no target text): compressed to the 1300ms floor
		// plus the 300ms tail after the last event (900ms) by the silent-shot
		// policy; the grouping itself is what this test pins down.
		expect(shots[1]).toMatchObject({ durationMs: 1300 });
		expect(shots[1].animationEvents).toHaveLength(2);
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

// Silent-pacing policy, calibrated on the real 口算乘法 deck (sample-deck.pptx,
// 19 pages / 127 shots / 83 voiced). Old policy: silent animation shots held
// 86.8s of the 428.5s cut, and slide-17 (practice page) strung six silent
// 1.8s groups after a narration tail into an 11.05s no-narration gap.
// New policy: exit-only silent shots floor at 900ms, reveal (entr/emph/path)
// silent shots floor at 1300ms, both keeping only a 300ms tail after the last
// event end; voiced shots and initial/static shots are untouched.
describe('silent shot retiming', () => {
	it('compresses a silent exit-only group to the 900ms floor', () => {
		const shots = buildStoryboardShots([
			slide({
				nativeAnimations: [
					{ targetId: 'text-1', presetClass: 'exit', durationMs: 500, trigger: 'onClick' },
				],
			}),
		]);
		expect(shots[1].script).toBe('');
		// Old policy: max(1800, 500 + 1000) = 1800. Exit floor 900 beats tail 800.
		expect(shots[1]).toMatchObject({ durationMs: 900 });
	});

	it('compresses a silent entrance reveal to the 1300ms floor', () => {
		const shots = buildStoryboardShots([
			slide({
				nativeAnimations: [
					{ targetId: 'missing-shape', presetClass: 'entr', durationMs: 700, trigger: 'onClick' },
				],
			}),
		]);
		expect(shots[1].script).toBe('');
		// Old policy: max(1800, 1700) = 1800. Reveal floor 1300 beats tail 1000.
		expect(shots[1]).toMatchObject({ durationMs: 1300 });
	});

	it('keeps a 300ms tail after the last event of a silent reveal', () => {
		const shots = buildStoryboardShots([
			slide({
				nativeAnimations: [
					{ targetId: 'missing-shape', presetClass: 'entr', durationMs: 1500, trigger: 'onClick' },
				],
			}),
		]);
		// Old policy: max(1800, 2500) = 2500. New: 1500 + 300 = 1800.
		expect(shots[1]).toMatchObject({ durationMs: 1800 });
	});

	it('takes max(floor, last event end + 300) for late silent offsets', () => {
		const shots = buildStoryboardShots([
			slide({
				animations: [
					{ elementId: 'ghost-1', emphasis: 'pulse', durationMs: 800, trigger: 'onClick' },
					{
						elementId: 'ghost-2',
						emphasis: 'pulse',
						durationMs: 700,
						trigger: 'afterPrevious',
						delayMs: 1000,
					},
				],
			}),
		]);
		expect(shots[1].script).toBe('');
		// Events end at 0+800 and 1800+700=2500. Old policy: 2500 + 1000 = 3500.
		// New: max(1300 floor, 2500 + 300) = 2800.
		expect(shots[1]).toMatchObject({ durationMs: 2800 });
	});

	it('never retimes voiced shots, initial shots, or static shots', () => {
		const voiced = buildStoryboardShots([
			slide({ animations: [{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 1500 }] }),
		]);
		expect(voiced[1].script).not.toBe('');
		// max(1800, 1500 + 1000) = 2500, unchanged by the silent policy.
		expect(voiced[1]).toMatchObject({ durationMs: 2500 });
		const quiet = buildStoryboardShots([slide()]);
		expect(quiet.map((shot) => shot.kind)).toStrictEqual(['static']);
		expect(quiet[0]).toMatchObject({ durationMs: 5000 });
	});

	it('retimes only after the final script is settled (polish dedup)', () => {
		// Both groups plan the same reveal text, so polishStoryboardScripts
		// blanks the second script through dedup: that shot must then be
		// compressed. Running the retime before polish would see a non-empty
		// planned script and wrongly keep 1900ms.
		const shots = buildStoryboardShots([
			slide({
				elements: [
					{ id: 'text-1', type: 'text', text: '勾股定理' } as PptxSlide['elements'][number],
					{ id: 'text-2', type: 'text', text: '勾股定理' } as PptxSlide['elements'][number],
				],
				animations: [
					{ elementId: 'text-1', entrance: 'fadeIn', durationMs: 900, trigger: 'onClick' },
					{ elementId: 'text-2', entrance: 'fadeIn', durationMs: 900, trigger: 'onClick' },
				],
			}),
		]);
		expect(shots[1]).toMatchObject({ script: '勾股定理。', durationMs: 1900 });
		expect(shots[2]).toMatchObject({ script: '', durationMs: 1300 });
	});

	it('exposes the pure retime for direct reuse and tests', () => {
		const base = {
			id: 'shot',
			slideIndex: 0,
			kind: 'animation' as const,
			label: '动画',
			effectLabel: '退出动画',
			script: '',
		};
		const silentExit: StoryboardShot = {
			...base,
			durationMs: 1800,
			animationEvents: [
				{ id: 'e1', targetId: 'a', startOffsetMs: 0, durationMs: 400, presetClass: 'exit' },
			],
		};
		const mixed: StoryboardShot = {
			...base,
			durationMs: 1800,
			animationEvents: [
				{ id: 'e1', targetId: 'a', startOffsetMs: 0, durationMs: 400, presetClass: 'exit' },
				{ id: 'e2', targetId: 'b', startOffsetMs: 400, durationMs: 400, presetClass: 'emph' },
			],
		};
		const retimed = retimeSilentStoryboardShots([silentExit, mixed]);
		expect(retimed[0]).toMatchObject({ durationMs: 900 });
		// One emph event turns the group into a reveal: 1300ms floor.
		expect(retimed[1]).toMatchObject({ durationMs: 1300 });
		// Same shots with a narration script keep their durations verbatim;
		// a whitespace-only script counts as silent, same as the adapter's
		// `script.trim()` rule.
		const spoken = retimeSilentStoryboardShots([
			{ ...silentExit, script: '答案消失。' },
			{ ...mixed, script: '  ' },
		]);
		expect(spoken[0]).toMatchObject({ durationMs: 1800 });
		expect(spoken[1]).toMatchObject({ durationMs: 1300 });
	});
});
