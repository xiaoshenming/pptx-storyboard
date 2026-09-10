import type { PptxSlide } from 'pptx-viewer-core';
import { useMemo } from 'react';

import { storyboardStaticMode } from './storyboard-mode';
import { buildStoryboardShots } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';

export function useStoryboardShots(slides: PptxSlide[]): StoryboardShot[] {
	const collapseAnimations = storyboardStaticMode();
	return useMemo(
		() => buildStoryboardShots(slides, { collapseAnimations }),
		[collapseAnimations, slides],
	);
}
