import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { StoryboardShot } from '../storyboard-model';

type SlideAnimation =
	| NonNullable<PptxSlide['animations']>[number]
	| NonNullable<PptxSlide['nativeAnimations']>[number];

function animationsFor(slide: PptxSlide): SlideAnimation[] {
	return slide.animations?.length ? slide.animations : (slide.nativeAnimations ?? []);
}

function animationTargetId(animation: SlideAnimation): string | undefined {
	return 'elementId' in animation ? animation.elementId : animation.targetId;
}

function isEntrance(animation: SlideAnimation): boolean {
	return 'elementId' in animation ? Boolean(animation.entrance) : animation.presetClass === 'entr';
}

function elementMatchesId(element: PptxElement, id: string): boolean {
	const baseId = id.split('::', 1)[0];
	return element.id === baseId || element.shapeId === baseId;
}

function unique(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function currentAnimationIds(slide: PptxSlide, shot: StoryboardShot): string[] {
	const animations = animationsFor(slide);
	const indices =
		shot.animationIndices ?? (shot.animationIndex === undefined ? [] : [shot.animationIndex]);
	const indexedTargets = unique(
		indices.map((index) => {
			const animation = animations[index];
			return animation && isEntrance(animation) ? animationTargetId(animation) : undefined;
		}),
	);
	if (indices.length > 0) {
		return indexedTargets;
	}
	return unique(
		shot.animationEvents
			?.filter((event) => event.presetClass === undefined || event.presetClass === 'entr')
			.map((event) => event.targetId) ?? [],
	);
}

function initialElementIds(slide: PptxSlide): string[] {
	const entranceIds = new Set(
		unique(animationsFor(slide).filter(isEntrance).map(animationTargetId)),
	);
	return slide.elements
		.filter((element) => {
			return ![element.id, element.shapeId].some((id) => id && entranceIds.has(id));
		})
		.map((element) => element.id);
}

export function targetElementsForShot(slide: PptxSlide, shot: StoryboardShot): PptxElement[] {
	const ids =
		shot.kind === 'animation'
			? currentAnimationIds(slide, shot)
			: shot.kind === 'initial'
				? initialElementIds(slide)
				: slide.elements.map((element) => element.id);
	return ids.flatMap((id) => slide.elements.filter((element) => elementMatchesId(element, id)));
}
