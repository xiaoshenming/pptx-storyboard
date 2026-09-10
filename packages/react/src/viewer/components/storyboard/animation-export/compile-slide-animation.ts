import type { PptxSlide } from 'pptx-viewer-core';
import { PresentationAnimationController } from 'pptx-viewer-shared';

import { FixedLogicalClock, sampleAnimationWindow } from './fixed-logical-clock';
import {
	advancePresentationStageState,
	clonePresentationStates,
	settlePresentationStageState,
} from './presentation-stage-state';
import type {
	CompileSlideAnimationOptions,
	CompiledAnimationClickGroup,
	CompiledSlideAnimationExport,
} from './types';

/** Compile the exact main-click timeline used by presentation playback. */
export function compileSlideAnimationExport(
	slide: PptxSlide,
	options: CompileSlideAnimationOptions = {},
): CompiledSlideAnimationExport {
	const clock = new FixedLogicalClock(options.framesPerSecond, options.originMs);
	const controller = PresentationAnimationController.fromSlide(slide);
	const initialState = clonePresentationStates(controller.computeStates({ elapsedMs: 0 }));
	const clickGroups: CompiledAnimationClickGroup[] = [];
	let settledState = clonePresentationStates(initialState);
	let cursorMs = clock.spec.originMs;

	while (controller.hasMoreSteps()) {
		const next = controller.peekNext();
		if (!next) {
			break;
		}
		const startAtMs = cursorMs + (next.autoAdvance ? (next.autoAdvanceDelayMs ?? 0) : 0);
		const group = controller.advance(startAtMs);
		if (!group) {
			break;
		}
		const groupDurationMs = Math.max(
			group.totalDurationMs,
			0,
			...group.steps.map((step) => step.delayMs + step.durationMs),
		);
		const settleAtMs = startAtMs + groupDurationMs;
		const samples = sampleAnimationWindow(clock.spec, startAtMs, settleAtMs);
		const stateBefore = clonePresentationStates(settledState);
		const activeState = advancePresentationStageState(stateBefore, group);
		settledState = settlePresentationStageState(stateBefore, group);
		clickGroups.push({
			index: clickGroups.length,
			group,
			startAtMs,
			settleAtMs,
			sampleTimesMs: samples.map((sample) => sample.atMs),
			samples,
			stateBefore,
			activeState,
			settledState: clonePresentationStates(settledState),
		});
		cursorMs = settleAtMs;
	}

	const frameSampleTimesMs = [
		...new Set([clock.spec.originMs, ...clickGroups.flatMap((compiled) => compiled.sampleTimesMs)]),
	].sort((left, right) => left - right);
	return {
		slideId: slide.id,
		initialState,
		clickGroups,
		keyframesCss: controller.keyframesCss,
		clock: clock.spec,
		frameSampleTimesMs,
		durationMs: Math.max(0, cursorMs - clock.spec.originMs),
	};
}

/** Compile every page independently, with each page starting at the same time origin. */
export function compilePresentationAnimationExports(
	slides: readonly PptxSlide[],
	options: CompileSlideAnimationOptions = {},
): CompiledSlideAnimationExport[] {
	return slides.map((slide) => compileSlideAnimationExport(slide, options));
}
