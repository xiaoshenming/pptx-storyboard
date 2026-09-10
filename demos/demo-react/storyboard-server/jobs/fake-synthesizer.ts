import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SynthesizedShotAudio } from '../render/video-renderer';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';

export function makeToneWav(durationMs: number, sampleRate = 16000): Buffer {
	const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
	const output = Buffer.alloc(44 + samples * 2);
	output.write('RIFF', 0);
	output.writeUInt32LE(output.length - 8, 4);
	output.write('WAVE', 8);
	output.write('fmt ', 12);
	output.writeUInt32LE(16, 16);
	output.writeUInt16LE(1, 20);
	output.writeUInt16LE(1, 22);
	output.writeUInt32LE(sampleRate, 24);
	output.writeUInt32LE(sampleRate * 2, 28);
	output.writeUInt16LE(2, 32);
	output.writeUInt16LE(16, 34);
	output.write('data', 36);
	output.writeUInt32LE(samples * 2, 40);
	for (let index = 0; index < samples; index += 1) {
		const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 1400);
		output.writeInt16LE(value, 44 + index * 2);
	}
	return output;
}

export class FakeStoryboardSynthesizer implements StoryboardSynthesizer {
	readonly providerName = 'fake-tone';
	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		const characters = [...input.text.replace(/\s/gu, '')];
		const durationMs = Math.max(700, Math.round((characters.length / 5) * 1000));
		const audioPath = join(
			input.outputDir,
			`audio-${input.clipId.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}.wav`,
		);
		await writeFile(audioPath, makeToneWav(durationMs), { mode: 0o600 });
		const step = durationMs / Math.max(1, characters.length);
		return {
			clipId: input.clipId,
			sourceShotId: input.sourceShotId,
			startMs: input.startMs,
			startSample: input.startSample,
			audioPath,
			durationMs,
			words: characters.map((text, index) => ({
				text,
				startMs: Math.round(index * step),
				endMs: Math.round((index + 1) * step),
			})),
		};
	}
}
