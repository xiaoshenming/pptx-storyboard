import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runCommand } from '../render/ffmpeg-runner';
import type { SynthesizedShotAudio } from '../render/video-renderer';
import { withAliyunTtsSlot } from '../tts/global-gate';
import { getTtsProviderConfig } from '../tts/provider-config';
import { getWavDurationMs } from '../tts/wav';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from './job-runner';

function endpoint(baseUrl: string): string {
	if (!baseUrl?.trim()) {
		throw new Error('ALIYUN_TTS_BASE_URL_MISSING');
	}
	try {
		return `${new URL(baseUrl).origin}/api/v1/services/audio/tts/SpeechSynthesizer`;
	} catch {
		throw new Error('ALIYUN_TTS_BASE_URL_INVALID');
	}
}

function safeAudioName(clipId: string): string {
	return clipId.replaceAll(/[^a-zA-Z0-9_-]/gu, '_');
}

async function waitBeforeRetry(delayMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		const abort = () => {
			clearTimeout(timer);
			reject(new DOMException('Cancelled', 'AbortError'));
		};
		signal.addEventListener('abort', abort, { once: true });
	});
}

function retryDelay(response: Response, attempt: number): number {
	const retryAfter = Number(response.headers.get('retry-after') || '');
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return Math.min(15_000, Math.max(250, Math.round(retryAfter * 1000)));
	}
	return Math.min(8_000, 500 * 2 ** attempt + Math.round(Math.random() * 150));
}

async function requestSpeech(
	config: ReturnType<typeof getTtsProviderConfig>,
	text: string,
	signal: AbortSignal,
): Promise<{ encoded?: string; audioUrl?: string }> {
	const maxAttempts = Math.max(
		1,
		Math.min(5, Number(process.env.STORYBOARD_ALIYUN_TTS_RETRIES || '3') + 1),
	);
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const response = await withAliyunTtsSlot(() =>
			fetch(endpoint(config.aliyunBaseUrl), {
				method: 'POST',
				signal,
				headers: {
					Authorization: `Bearer ${config.aliyunApiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: config.aliyunModel,
					input: {
						text,
						voice: config.aliyunVoice,
						format: 'wav',
						sample_rate: 24_000,
					},
				}),
			}),
		);
		if (response.ok) {
			const payload = (await response.json()) as {
				output?: { audio?: { data?: string; url?: string } };
			};
			return {
				encoded: payload.output?.audio?.data,
				audioUrl: payload.output?.audio?.url,
			};
		}
		const detail = (await response.text()).slice(0, 500).replaceAll(/\s+/gu, ' ');
		const retryable = response.status === 429 || response.status >= 500;
		if (!retryable || attempt >= maxAttempts - 1) {
			throw new Error(`ALIYUN_TTS_HTTP_${response.status}${detail ? `: ${detail}` : ''}`);
		}
		await waitBeforeRetry(retryDelay(response, attempt), signal);
	}
	throw new Error('ALIYUN_TTS_RETRY_EXHAUSTED');
}

export class AliyunStoryboardSynthesizer implements StoryboardSynthesizer {
	readonly providerName = 'aliyun-compatible';

	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		const config = getTtsProviderConfig();
		const apiKey = config.aliyunApiKey;
		if (!apiKey) {
			throw new Error('ALIYUN_TTS_API_KEY_MISSING');
		}
		if (input.signal.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const { encoded, audioUrl } = await requestSpeech(config, input.text, input.signal);
		let sourceAudio: Buffer;
		if (encoded) {
			sourceAudio = Buffer.from(encoded, 'base64');
		} else if (audioUrl) {
			const audioResponse = await fetch(audioUrl, { signal: input.signal });
			if (!audioResponse.ok) {
				throw new Error(`ALIYUN_AUDIO_HTTP_${audioResponse.status}`);
			}
			sourceAudio = Buffer.from(await audioResponse.arrayBuffer());
		} else {
			throw new Error('ALIYUN_TTS_AUDIO_MISSING');
		}
		if (sourceAudio.byteLength < 16) {
			throw new Error('ALIYUN_TTS_EMPTY_AUDIO');
		}
		const sourcePath = join(input.outputDir, `aliyun-source-${safeAudioName(input.clipId)}`);
		const audioPath = join(input.outputDir, `audio-${safeAudioName(input.clipId)}.wav`);
		await writeFile(sourcePath, sourceAudio, { mode: 0o600 });
		try {
			await runCommand(
				'ffmpeg',
				[
					'-y',
					'-nostdin',
					'-i',
					sourcePath,
					'-ar',
					'16000',
					'-ac',
					'1',
					'-c:a',
					'pcm_s16le',
					audioPath,
				],
				{ signal: input.signal, timeoutMs: 60_000 },
			);
		} finally {
			await rm(sourcePath, { force: true });
		}
		const audio = await readFile(audioPath);
		const durationMs = getWavDurationMs(audio);
		const characters = [...input.text.replace(/\s/gu, '')];
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
