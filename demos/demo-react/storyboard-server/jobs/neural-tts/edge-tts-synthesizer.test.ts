import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EdgeTtsStoryboardSynthesizer } from './edge-tts-synthesizer';
import { NeuralTtsError } from './errors';
import { pcmWavDurationMs } from './wav';

const fixturePath = fileURLToPath(new URL('./__fixtures__/fake-edge-bridge.mjs', import.meta.url));

function input(outputDir: string, signal = new AbortController().signal) {
	return {
		taskId: 'job:tts:test',
		clipId: 'clip/one',
		sourceShotId: 'shot-one',
		startMs: 1200,
		startSample: 28_800,
		text: '函数图像',
		voiceType: 101001,
		speed: 0,
		outputDir,
		signal,
	};
}

describe('edge TTS storyboard synthesizer', () => {
	it('returns final PCM WAV, measured duration, and provider boundaries', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'edge-tts-test-'));
		try {
			const synthesizer = new EdgeTtsStoryboardSynthesizer({
				bridgeInvocation: () => ({ command: process.execPath, args: [fixturePath] }),
			});
			const result = await synthesizer.synthesize(input(outputDir));
			expect(result.audioPath).toBe(join(outputDir, 'audio-clip_one.wav'));
			expect(result.durationMs).toBeGreaterThanOrEqual(790);
			expect(result.durationMs).toBeLessThanOrEqual(810);
			expect(result.words).toStrictEqual([
				{ text: '函数', startMs: 50, endMs: 350 },
				{ text: '图像', startMs: 370, endMs: 740 },
			]);
			const wav = await readFile(result.audioPath!);
			expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
			expect(pcmWavDurationMs(wav)).toBe(result.durationMs);
			await expect(access(join(outputDir, 'audio-clip_one.edge.mp3'))).rejects.toThrow();
			await expect(access(join(outputDir, 'audio-clip_one.boundaries.json'))).rejects.toThrow();
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	it('cancels a running provider process and leaves no partial WAV', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'edge-tts-cancel-'));
		const controller = new AbortController();
		try {
			const synthesizer = new EdgeTtsStoryboardSynthesizer({
				bridgeInvocation: () => ({
					command: process.execPath,
					args: ['-e', 'setTimeout(() => {}, 60_000)', '--'],
				}),
				timeoutMs: 5000,
			});
			const pending = synthesizer.synthesize(input(outputDir, controller.signal));
			setTimeout(() => controller.abort(), 30);
			await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
			await expect(access(join(outputDir, 'audio-clip_one.wav'))).rejects.toThrow();
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	it('reports timeout distinctly and cleans partial output', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'edge-tts-timeout-'));
		try {
			const synthesizer = new EdgeTtsStoryboardSynthesizer({
				bridgeInvocation: () => ({
					command: process.execPath,
					args: ['-e', 'setTimeout(() => {}, 60_000)', '--'],
				}),
				timeoutMs: 30,
			});
			await expect(synthesizer.synthesize(input(outputDir))).rejects.toMatchObject<NeuralTtsError>({
				code: 'EDGE_TTS_TIMEOUT',
			});
			await expect(access(join(outputDir, 'audio-clip_one.wav'))).rejects.toThrow();
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});

	it('retries transient provider process failures', async () => {
		const outputDir = await mkdtemp(join(tmpdir(), 'edge-tts-retry-'));
		let attempts = 0;
		try {
			const synthesizer = new EdgeTtsStoryboardSynthesizer({
				bridgeInvocation: () => {
					attempts += 1;
					return attempts === 1
						? { command: process.execPath, args: ['-e', 'process.exit(1)', '--'] }
						: { command: process.execPath, args: [fixturePath] };
				},
				maxRetries: 1,
			});
			await expect(synthesizer.synthesize(input(outputDir))).resolves.toMatchObject({
				durationMs: 800,
			});
			expect(attempts).toBe(2);
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});
