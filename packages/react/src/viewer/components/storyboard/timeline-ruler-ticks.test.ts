import { expect, test } from 'vitest';

import { timelineRulerTicks } from './timeline-ruler-ticks';

test('bounds ruler DOM size for long generated narration while retaining short timeline seconds', () => {
	expect(timelineRulerTicks(5000)).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
	const ticks = timelineRulerTicks(24 * 60 * 60 * 1000);
	expect(ticks.length).toBeLessThanOrEqual(1000);
	expect(ticks[0]).toBe(0);
	expect(ticks.at(-1)).toBeGreaterThanOrEqual(24 * 60 * 60);
	expect(timelineRulerTicks(Infinity)).toStrictEqual([0]);
});
