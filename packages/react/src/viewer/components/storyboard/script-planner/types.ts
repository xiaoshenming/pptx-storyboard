import type { PptxSlide } from 'pptx-viewer-core';

import type { StoryboardShot } from '../storyboard-model';

export interface StoryboardScriptPlan {
	preCue: string;
	revealCue: string;
	postCue: string;
	speakText: string;
	targetElementIds: string[];
	sourceText: string;
}

export type StoryboardScriptPlanner = (
	slide: PptxSlide,
	shot: StoryboardShot,
) => StoryboardScriptPlan;
