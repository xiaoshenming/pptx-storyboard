import type { TimelineClickGroup } from 'pptx-viewer-shared';

const ANIMATION_SURFACE_SELECTOR =
	'[data-element-id], [data-anim-id], [data-pptx-animation-layer="background"]';

export interface StageAnimationSeekResult {
	readonly matched: number;
	readonly sought: number;
	readonly failed: number;
}

function animationTargetId(element: HTMLElement): string | undefined {
	if (element.dataset.pptxAnimationLayer === 'background') {
		const hostId = element.closest<HTMLElement>('[data-element-id]')?.dataset.elementId;
		return hostId ? `${hostId}::pptx-bg` : undefined;
	}
	return element.dataset.animId ?? element.dataset.elementId;
}

/**
 * Pause and seek only Web Animations owned by the supplied current
 * PresentationStage. Passing a document or an outer viewer root is rejected so
 * parallel/offscreen stages cannot be changed accidentally.
 */
export function pauseAndSeekPresentationStageAnimations(
	stage: HTMLElement,
	currentTimeMs: number,
	group?: TimelineClickGroup,
): StageAnimationSeekResult {
	if (!stage.hasAttribute('data-pptx-presentation-stage')) {
		throw new TypeError('stage must be the current PresentationStage element');
	}
	if (!Number.isFinite(currentTimeMs) || currentTimeMs < 0) {
		throw new RangeError('currentTimeMs must be a finite non-negative number');
	}
	const targetIds = group
		? new Set(group.steps.filter((step) => !step.command).map((step) => step.elementId))
		: undefined;
	const animations = new Set<Animation>();
	for (const element of stage.querySelectorAll<HTMLElement>(ANIMATION_SURFACE_SELECTOR)) {
		if (targetIds && !targetIds.has(animationTargetId(element) ?? '')) {
			continue;
		}
		if (typeof element.getAnimations !== 'function') {
			continue;
		}
		for (const animation of element.getAnimations()) {
			animations.add(animation);
		}
	}

	let sought = 0;
	let failed = 0;
	for (const animation of animations) {
		try {
			animation.pause();
			animation.currentTime = currentTimeMs;
			sought += 1;
		} catch {
			failed += 1;
		}
	}
	return { matched: animations.size, sought, failed };
}
