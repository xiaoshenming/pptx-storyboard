import { computeBuildProgress } from 'pptx-viewer-shared';
import type { ElementAnimationState, TimelineClickGroup, TimelineStep } from 'pptx-viewer-shared';

export function clonePresentationStates(
	states: ReadonlyMap<string, ElementAnimationState>,
): Map<string, ElementAnimationState> {
	return new Map(
		[...states].map(([id, state]) => [
			id,
			{ ...state, build: state.build ? { ...state.build } : undefined },
		]),
	);
}

function projectStep(
	current: ElementAnimationState,
	step: TimelineStep,
	elapsedMs: number,
): ElementAnimationState {
	const completed = elapsedMs >= Math.max(0, step.delayMs + step.durationMs);
	const hidesAtEnd = step.presetClass === 'exit' || step.hideAfterEffect === true;
	const holdsPaint =
		step.holdEndState === true && step.colorTargets !== undefined && step.colorTargets.length > 0;
	return {
		...current,
		visible: completed && hidesAtEnd ? false : step.presetClass === 'exit' ? current.visible : true,
		cssAnimation: completed && !step.holdEndState ? undefined : step.cssAnimation,
		build: step.build
			? { ...step.build, progress: computeBuildProgress(step, elapsedMs) }
			: current.build,
		animatesFill:
			(!completed || holdsPaint) && step.colorTargets?.includes('fill') ? true : undefined,
		animatesStroke:
			(!completed || holdsPaint) && step.colorTargets?.includes('stroke') ? true : undefined,
	};
}

/** Project one real click-group onto the state map consumed by PresentationStage. */
export function advancePresentationStageState(
	previous: ReadonlyMap<string, ElementAnimationState>,
	group: TimelineClickGroup,
	elapsedMs = 0,
): Map<string, ElementAnimationState> {
	const next = clonePresentationStates(previous);
	for (const step of group.steps) {
		if (step.command) {
			continue;
		}
		const current = next.get(step.elementId) ?? { visible: true, cssAnimation: undefined };
		next.set(step.elementId, projectStep(current, step, Math.max(0, elapsedMs)));
	}
	return next;
}

/** Fold a click-group to the same stable state reached after all its effects finish. */
export function settlePresentationStageState(
	previous: ReadonlyMap<string, ElementAnimationState>,
	group: TimelineClickGroup,
): Map<string, ElementAnimationState> {
	const settleAt = Math.max(
		group.totalDurationMs,
		0,
		...group.steps.map((step) => step.delayMs + step.durationMs),
	);
	return advancePresentationStageState(previous, group, settleAt);
}
