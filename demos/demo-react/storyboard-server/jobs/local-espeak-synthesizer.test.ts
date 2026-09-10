import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalEspeakStoryboardSynthesizer } from './local-espeak-synthesizer';

describe('local espeak synthesizer', () => {
	it('creates audible Mandarin WAV with timing boundaries', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'local-espeak-test-'));
		try {
			const result = await new LocalEspeakStoryboardSynthesizer().synthesize({
				taskId: 'job:tts:test',
				clipId: 'clip-one',
				sourceShotId: 'shot-one',
				startMs: 0,
				startSample: 0,
				text: '三乘以四等于十二。',
				voiceType: 101001,
				speed: 0,
				outputDir,
				signal: new AbortController().signal,
			});
			expect(result.durationMs).toBeGreaterThan(500);
			expect(result.words.length).toBeGreaterThan(5);
			expect(result.audioPath).toContain('audio-clip-one.wav');
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});
