import { expect, test } from 'vitest';

import {
	captureGenerationProgress,
	polishGenerationProgress,
	serverGenerationProgress,
} from './storyboard-generation-progress';

test('allocates polish and capture to the first seventy percent', () => {
	expect(polishGenerationProgress(0, 10)).toBe(5);
	expect(polishGenerationProgress(10, 10)).toBe(45);
	expect(captureGenerationProgress(0, 10)).toBe(45);
	expect(captureGenerationProgress(10, 10)).toBe(70);
});

test('maps server generation into the final thirty percent', () => {
	expect(serverGenerationProgress(0)).toBe(70);
	expect(serverGenerationProgress(50)).toBe(85);
	expect(serverGenerationProgress(100)).toBe(100);
	expect(serverGenerationProgress(120)).toBe(100);
});
