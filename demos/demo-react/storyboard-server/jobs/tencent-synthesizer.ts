import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SynthesizedShotAudio } from '../render/video-renderer';
import { TencentTtsService } from '../tts';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';

function credentials(): { secretId: string; secretKey: string; securityToken?: string } {
	const secretId = process.env.TENCENT_TTS_SECRET_ID?.trim() || '';
	const secretKey = process.env.TENCENT_TTS_SECRET_KEY?.trim() || '';
	if (!secretId || !secretKey) {
		throw new Error('TENCENT_TTS_CREDENTIALS_MISSING');
	}
	return {
		secretId,
		secretKey,
		securityToken: process.env.TENCENT_TTS_SECURITY_TOKEN?.trim() || undefined,
	};
}

export class TencentStoryboardSynthesizer implements StoryboardSynthesizer {
	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		if (input.signal.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const service = new TencentTtsService({
			credentials: credentials(),
			region: process.env.TENCENT_TTS_REGION?.trim() || undefined,
			voiceType: input.voiceType,
			speed: input.speed,
			sampleRate: 16000,
			concurrency: Math.max(
				1,
				Math.min(6, Number(process.env.STORYBOARD_TTS_CHUNK_CONCURRENCY || '4')),
			),
			maxRetries: 2,
			retryBaseDelayMs: 250,
		});
		const result = await service.synthesize({
			text: input.text,
			taskId: input.taskId,
			signal: input.signal,
		});
		if (input.signal.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const audioPath = join(
			input.outputDir,
			`audio-${input.clipId.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')}.wav`,
		);
		await writeFile(audioPath, result.audio, { mode: 0o600 });
		return {
			clipId: input.clipId,
			sourceShotId: input.sourceShotId,
			startMs: input.startMs,
			startSample: input.startSample,
			audioPath,
			durationMs: result.durationMs,
			words: result.subtitles.map((subtitle) => ({
				text: subtitle.text,
				startMs: subtitle.beginTimeMs,
				endMs: subtitle.endTimeMs,
			})),
		};
	}
}
