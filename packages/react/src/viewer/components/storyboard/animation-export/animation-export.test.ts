import type { PptxElement, PptxNativeAnimation, PptxSlide } from 'pptx-viewer-core';
import type { ElementAnimationState, TimelineClickGroup, TimelineStep } from 'pptx-viewer-shared';
import { describe, expect, it, vi } from 'vitest';

import {
	compilePresentationAnimationExports,
	compileSlideAnimationExport,
} from './compile-slide-animation';
import { FixedLogicalClock, sampleAnimationWindow } from './fixed-logical-clock';
import {
	advancePresentationStageState,
	settlePresentationStageState,
} from './presentation-stage-state';
import { pauseAndSeekPresentationStageAnimations } from './stage-web-animations';

function shape(id: string): PptxElement {
	return { type: 'shape', id, x: 0, y: 0, width: 100, height: 100 } as PptxElement;
}

function text(id: string, value: string): PptxElement {
	return {
		type: 'text',
		id,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		text: value,
		textSegments: [{ text: value }],
	} as unknown as PptxElement;
}

function native(
	targetId: string,
	presetClass: 'entr' | 'exit',
	trigger: PptxNativeAnimation['trigger'],
	durationMs: number,
	delayMs = 0,
): PptxNativeAnimation {
	return {
		targetId,
		presetClass,
		presetId: presetClass === 'exit' ? 10 : 1,
		trigger,
		durationMs,
		delayMs,
	} as PptxNativeAnimation;
}

function step(overrides: Partial<TimelineStep> = {}): TimelineStep {
	return {
		elementId: 'shape-1',
		cssAnimation: 'pptx-fadeIn 200ms linear 0ms 1 both',
		keyframeName: 'pptx-fadeIn',
		trigger: 'onClick',
		delayMs: 0,
		durationMs: 200,
		fillMode: 'both',
		presetClass: 'entr',
		...overrides,
	};
}

describe('compileSlideAnimationExport', () => {
	it('compiles real click groups and trigger timing through the shared controller', () => {
		const slide = {
			id: 'slide-1',
			elements: [shape('a'), shape('b'), shape('c'), shape('d')],
			nativeAnimations: [
				native('a', 'entr', 'onClick', 400),
				native('b', 'entr', 'withPrevious', 200, 100),
				native('c', 'entr', 'afterPrevious', 300, 50),
				native('d', 'exit', 'onClick', 250),
			],
		} as PptxSlide;

		const compiled = compileSlideAnimationExport(slide, { framesPerSecond: 20 });

		expect(compiled.clickGroups).toHaveLength(2);
		expect(compiled.clickGroups[0].group.steps.map((item) => item.trigger)).toStrictEqual([
			'onClick',
			'withPrevious',
			'afterPrevious',
		]);
		expect(compiled.clickGroups[0].group.steps.map((item) => item.delayMs)).toStrictEqual([
			0, 100, 350,
		]);
		expect(compiled.clickGroups[0].settleAtMs).toBe(650);
		expect(compiled.clickGroups[1].startAtMs).toBe(650);
		expect(compiled.initialState.get('a')?.visible).toBeFalsy();
		expect(compiled.clickGroups[0].settledState.get('a')?.visible).toBeTruthy();
		expect(compiled.clickGroups[1].activeState.get('d')?.visible).toBeTruthy();
		expect(compiled.clickGroups[1].settledState.get('d')?.visible).toBeFalsy();
		expect(compiled.keyframesCss).toContain('@keyframes');
		expect(compiled.durationMs).toBe(900);
	});

	it('includes controller-expanded text-build steps instead of source placeholders', () => {
		const slide = {
			id: 'slide-text',
			elements: [text('title', 'one two three')],
			nativeAnimations: [
				{
					...native('title', 'entr', 'onClick', 600),
					buildType: 'byWord',
				},
			],
		} as PptxSlide;

		const compiled = compileSlideAnimationExport(slide);
		const ids = compiled.clickGroups.flatMap(({ group }) =>
			group.steps.map((item) => item.elementId),
		);

		expect(ids).toStrictEqual(['title::w0-0', 'title::w0-1', 'title::w0-2']);
		expect(compiled.initialState.get('title')?.visible).toBeTruthy();
		expect(compiled.initialState.get('title::w0-0')?.visible).toBeFalsy();
	});

	it('returns a stable empty timeline for a static slide', () => {
		const compiled = compileSlideAnimationExport({
			id: 'static',
			elements: [shape('always-visible')],
		} as PptxSlide);

		expect(compiled.clickGroups).toStrictEqual([]);
		expect(compiled.frameSampleTimesMs).toStrictEqual([0]);
		expect(compiled.initialState.get('always-visible')).toStrictEqual({
			visible: true,
			cssAnimation: undefined,
			build: undefined,
		});
	});

	it('compiles every page with an independent fixed clock', () => {
		const slides = [
			{ id: 'first', elements: [shape('a')] },
			{ id: 'second', elements: [shape('b')] },
		] as PptxSlide[];
		const compiled = compilePresentationAnimationExports(slides, {
			framesPerSecond: 24,
			originMs: 100,
		});

		expect(compiled.map((page) => page.slideId)).toStrictEqual(['first', 'second']);
		expect(compiled.map((page) => page.clock.originMs)).toStrictEqual([100, 100]);
		expect(compiled.map((page) => page.clock.framesPerSecond)).toStrictEqual([24, 24]);
	});
});

describe('fixedLogicalClock', () => {
	it('advances by frame number without accumulating floating-point tick drift', () => {
		const clock = new FixedLogicalClock(25, 100);
		expect(clock.nowMs).toBe(100);
		expect(clock.tick()).toBe(140);
		expect(clock.seekFrame(10)).toBe(500);
		expect(clock.timeAtFrame(100)).toBe(4100);
	});

	it('samples exact effect boundaries and fixed frame instants', () => {
		const clock = new FixedLogicalClock(25);
		const samples = sampleAnimationWindow(clock.spec, 0, 90);
		expect(samples.map((sample) => sample.atMs)).toStrictEqual([0, 40, 80, 90]);
		expect(samples.map((sample) => sample.boundary)).toStrictEqual([
			'start',
			'frame',
			'frame',
			'settle',
		]);
	});

	it('rejects invalid frame rates and backwards windows', () => {
		expect(() => new FixedLogicalClock(0)).toThrow(RangeError);
		const clock = new FixedLogicalClock();
		expect(() => clock.seekFrame(-1)).toThrow(RangeError);
		expect(clock.frameIndex).toBe(0);
		expect(() => sampleAnimationWindow(clock.spec, 20, 10)).toThrow(RangeError);
	});
});

describe('presentationStage state projection', () => {
	it('keeps exits visible while active and hides them only when settled', () => {
		const initial = new Map<string, ElementAnimationState>([
			['shape-1', { visible: true, cssAnimation: undefined }],
		]);
		const group: TimelineClickGroup = {
			steps: [step({ presetClass: 'exit', delayMs: 100, durationMs: 200 })],
			totalDurationMs: 300,
		};

		expect(advancePresentationStageState(initial, group, 250).get('shape-1')?.visible).toBeTruthy();
		expect(settlePresentationStageState(initial, group).get('shape-1')?.visible).toBeFalsy();
		expect(initial.get('shape-1')?.visible).toBeTruthy();
	});

	it('projects staged-build progress at an exact logical time', () => {
		const group: TimelineClickGroup = {
			steps: [
				step({
					delayMs: 100,
					durationMs: 400,
					build: { kind: 'chart', mode: 'bySeries' },
				}),
			],
			totalDurationMs: 500,
		};
		const state = advancePresentationStageState(new Map(), group, 300);
		expect(state.get('shape-1')?.build).toStrictEqual({
			kind: 'chart',
			mode: 'bySeries',
			progress: 0.5,
		});
	});
});

describe('pauseAndSeekPresentationStageAnimations', () => {
	it('seeks only matching animations beneath the supplied stage', () => {
		const wanted = { pause: vi.fn(), currentTime: 0 };
		const unrelated = { pause: vi.fn(), currentTime: 0 };
		const elements = [
			{
				dataset: { elementId: 'shape-1' },
				getAnimations: () => [wanted],
			},
			{
				dataset: { elementId: 'shape-2' },
				getAnimations: () => [unrelated],
			},
		];
		const stage = {
			hasAttribute: (name: string) => name === 'data-pptx-presentation-stage',
			querySelectorAll: () => elements,
		} as unknown as HTMLElement;
		const group: TimelineClickGroup = { steps: [step()], totalDurationMs: 200 };

		const result = pauseAndSeekPresentationStageAnimations(stage, 125, group);

		expect(result).toStrictEqual({ matched: 1, sought: 1, failed: 0 });
		expect(wanted.pause).toHaveBeenCalledOnce();
		expect(wanted.currentTime).toBe(125);
		expect(unrelated.pause).not.toHaveBeenCalled();
	});

	it('rejects an outer root so another presentation stage cannot be touched', () => {
		const outer = {
			hasAttribute: () => false,
			querySelectorAll: vi.fn(),
		} as unknown as HTMLElement;
		expect(() => pauseAndSeekPresentationStageAnimations(outer, 0)).toThrow(TypeError);
		expect(outer.querySelectorAll).not.toHaveBeenCalled();
	});
});
