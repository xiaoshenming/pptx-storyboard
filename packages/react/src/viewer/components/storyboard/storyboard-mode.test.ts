import { describe, expect, it } from 'vitest';

import { storyboardSlideSelection, storyboardStaticMode } from './storyboard-mode';

describe('storyboard URL modes', () => {
	it('enables static export explicitly', () => {
		expect(storyboardStaticMode('?storyboardMode=static')).toBeTruthy();
		expect(storyboardStaticMode('?storyboardMode=animated')).toBeFalsy();
	});

	it('parses a selected slide list and rejects invalid entries', () => {
		expect([...storyboardSlideSelection('?storyboardSlides=6,7,bad,12')!]).toStrictEqual([
			6, 7, 12,
		]);
		expect(storyboardSlideSelection('?storyboardSlides=bad')).toBeUndefined();
	});
});
