import type { PptxSlide } from 'pptx-viewer-core';
import { useMemo } from 'react';

import { storyboardSlideSelection, storyboardStaticMode } from './storyboard-mode';
import { buildStoryboardShots } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';

export function useStoryboardShots(slides: PptxSlide[]): StoryboardShot[] {
	const collapseAnimations = storyboardStaticMode();
	const selectedSlides = useMemo(() => storyboardSlideSelection(), []);
	return useMemo(
		() =>
			buildStoryboardShots(slides, { collapseAnimations }).filter(
				(shot) => !selectedSlides || selectedSlides.has(shot.slideIndex + 1),
			),
		[collapseAnimations, selectedSlides, slides],
	);
}
