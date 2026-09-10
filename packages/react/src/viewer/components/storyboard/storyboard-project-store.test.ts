import { describe, expect, it } from 'vitest';

import type { StoryboardShot } from './storyboard-model';
import { storyboardProjectId } from './storyboard-project-store';

function shot(script: string): StoryboardShot {
	return {
		id: 'slide-1-static',
		slideIndex: 0,
		kind: 'static',
		label: '第 1 页',
		effectLabel: '静态页面',
		durationMs: 5000,
		script,
	};
}

describe('storyboardProjectId', () => {
	it('separates same-name decks when their content differs', () => {
		expect(storyboardProjectId('同名.pptx', [shot('甲')])).not.toBe(
			storyboardProjectId('同名.pptx', [shot('乙')]),
		);
	});
});
