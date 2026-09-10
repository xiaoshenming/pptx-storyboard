import { describe, expect, it } from 'vitest';

import type { StoryboardJobManifest } from '../jobs/job-types';
import { compileRenderTiming } from './timing';
import type { SynthesizedShotAudio } from './video-renderer';

const manifest: StoryboardJobManifest = {
	version: 1,
	fileName: 'deck.pptx',
	width: 1920,
	height: 1080,
	fps: 30,
	voiceType: 101001,
	speed: 0,
	shots: [
		{
			id: 'a',
			frameFile: 'a.png',
			startMs: 0,
			durationMs: 5_000,
			startFrame: 0,
			frameCount: 150,
			script: '',
			subtitlesEnabled: true,
		},
		{
			id: 'b',
			frameFile: 'b.png',
			startMs: 5_000,
			durationMs: 5_000,
			startFrame: 150,
			frameCount: 150,
			script: '',
			subtitlesEnabled: true,
		},
	],
	narrationClips: [],
};

function audio(
	clipId: string,
	sourceShotId: string,
	startMs: number,
	durationMs: number,
): SynthesizedShotAudio {
	return {
		clipId,
		sourceShotId,
		startMs,
		startSample: 0,
		durationMs,
		words: [],
	};
}

describe('compileRenderTiming', () => {
	it('ripples later shots after TTS expands an earlier shot', () => {
		const result = compileRenderTiming(manifest, [
			audio('one', 'a', 0, 8_000),
			audio('two', 'b', 5_000, 2_000),
		]);
		expect(result.shotFrameCounts).toStrictEqual([248, 150]);
		expect(result.shotDurationsMs[0]).toBeCloseTo(8_266.667, 2);
		expect(result.shotStartsMs[1]).toBeCloseTo(8_266.667, 2);
		expect(result.audio.get('two')?.clipId).toBe('two');
		expect(result.audio.get('two')?.startMs).toBeCloseTo(8_266.667, 2);
		expect(result.audio.get('two')?.startSample).toBe(396_800);
		expect(result.totalDurationMs).toBeCloseTo(13_266.667, 2);
	});

	it('preserves a narration offset inside its source shot', () => {
		const result = compileRenderTiming(manifest, [audio('offset', 'b', 6_000, 1_000)]);
		expect(result.audio.get('offset')?.startMs).toBe(6_000);
	});
});
