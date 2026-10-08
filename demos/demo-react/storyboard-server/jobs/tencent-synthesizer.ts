import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SynthesizedShotAudio } from '../render/video-renderer';
import { TencentTtsService } from '../tts';
import { getTtsProviderConfig } from '../tts/provider-config';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';

function credentials(): { secretId: string; secretKey: string; securityToken?: string } {
	const config = getTtsProviderConfig();
	const secretId = config.tencentSecretId;
	const secretKey = config.tencentSecretKey;
	if (!secretId || !secretKey) {
		throw new Error('TENCENT_TTS_CREDENTIALS_MISSING');
	}
	return {
		secretId,
		secretKey,
		securityToken: config.tencentSecurityToken || undefined,
	};
}

export class TencentStoryboardSynthesizer implements StoryboardSynthesizer {
	readonly providerName = 'tencent-cloud';
	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		if (input.signal.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const service = new TencentTtsService({
			credentials: credentials(),
			region: getTtsProviderConfig().tencentRegion || undefined,
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
