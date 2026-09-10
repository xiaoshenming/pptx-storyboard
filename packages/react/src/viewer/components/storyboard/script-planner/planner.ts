import type { PptxSlide } from 'pptx-viewer-core';

import type { StoryboardShot } from '../storyboard-model';
import { targetElementsForShot } from './targets';
import { cleanMathNarration, elementTextFragments } from './text';
import type { StoryboardScriptPlan } from './types';

interface Cues {
	preCue: string;
	revealCue: string;
	postCue: string;
}

function cuesFor(shot: StoryboardShot, sourceText: string): Cues {
	if (!sourceText) {
		return { preCue: '', revealCue: '', postCue: '' };
	}
	return { preCue: '', revealCue: sourceText, postCue: '' };
}

export function planStoryboardScript(slide: PptxSlide, shot: StoryboardShot): StoryboardScriptPlan {
	const targets = targetElementsForShot(slide, shot);
	const sourceText = cleanMathNarration(targets.flatMap(elementTextFragments));
	const cues = cuesFor(shot, sourceText);
	return {
		...cues,
		speakText: [cues.preCue, cues.revealCue, cues.postCue].filter(Boolean).join(''),
		targetElementIds: targets.map((element) => element.id),
		sourceText,
	};
}
