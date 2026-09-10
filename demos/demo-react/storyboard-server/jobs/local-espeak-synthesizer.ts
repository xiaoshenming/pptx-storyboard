import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runCommand } from '../render/ffmpeg-runner';
import type { SynthesizedShotAudio } from '../render/video-renderer';
import { getWavDurationMs } from '../tts/wav';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';

function speechRate(speed: number): number {
	return Math.round(Math.max(110, Math.min(260, 165 * 2 ** (speed / 6))));
}

export async function synthesizeLocalWav(
	text: string,
	speed: number,
	outputPath: string,
	signal: AbortSignal,
): Promise<{ audio: Buffer; durationMs: number }> {
	await runCommand(
		'espeak-ng',
		['-v', 'cmn', '-s', String(speechRate(speed)), '-a', '165', '-w', outputPath, text],
		{ signal, timeoutMs: 60_000 },
	);
	const audio = await readFile(outputPath);
	return { audio, durationMs: getWavDurationMs(audio) };
}

export class LocalEspeakStoryboardSynthesizer implements StoryboardSynthesizer {
	readonly providerName = 'local-espeak';

	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		const audioPath = join(
			input.outputDir,
			`audio-${input.clipId.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}.wav`,
		);
		const result = await synthesizeLocalWav(input.text, input.speed, audioPath, input.signal);
		await chmod(audioPath, 0o600);
		const characters = [...input.text.replace(/\s/gu, '')];
		const step = result.durationMs / Math.max(1, characters.length);
		return {
			clipId: input.clipId,
			sourceShotId: input.sourceShotId,
			startMs: input.startMs,
			startSample: input.startSample,
			audioPath,
			durationMs: result.durationMs,
			words: characters.map((text, index) => ({
				text,
				startMs: Math.round(index * step),
				endMs: Math.round((index + 1) * step),
			})),
		};
	}
}
