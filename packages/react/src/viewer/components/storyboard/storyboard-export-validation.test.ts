import { expect, test } from 'vitest';

import { storyboardJobError, assertStoryboardExportReady } from './storyboard-export-validation';
import type { StoryboardManifest } from './storyboard-job-client';

test('surfaces server rejection codes rather than hiding a 400 response', async () => {
	expect(
		(await storyboardJobError(Response.json({ error: 'INVALID_SHOT_DURATION' }, { status: 400 })))
			.message,
	).toContain('分镜时长');
	expect(
		(await storyboardJobError(Response.json({ error: 'INVALID_SHOT_DURATION' }, { status: 400 })))
			.message,
	).toContain('INVALID_SHOT_DURATION');
});

test('rejects invalid timing before capture or upload', () => {
	const m = {
		shots: [{ id: 's', durationMs: NaN, startFrame: 0, script: '' }],
		narrationClips: [],
	} as unknown as StoryboardManifest;
	expect(() => assertStoryboardExportReady(m)).toThrow('时长');
	m.shots[0].durationMs = 2500;
	expect(() => assertStoryboardExportReady(m)).not.toThrow();
});
