import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Connect } from 'vite';

import { AliyunStoryboardSynthesizer } from '../jobs/aliyun-synthesizer';
import { makeToneWav } from '../jobs/fake-synthesizer';
import { synthesizeLocalWav } from '../jobs/local-espeak-synthesizer';
import { EdgeTtsStoryboardSynthesizer } from '../jobs/neural-tts';
import { acceptsContentType } from '../request-security';
import { getTtsProviderConfig } from './provider-config';
import { TencentTtsService } from './service';

async function readJson(request: import('node:http').IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 32 * 1024) {
			throw new Error('REQUEST_TOO_LARGE');
		}
		chunks.push(Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function respond(
	response: import('node:http').ServerResponse,
	status: number,
	body: unknown,
): void {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(body));
}

function previewError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replaceAll(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]')
		.replaceAll(/sk-[A-Za-z0-9._-]+/gu, '[redacted]')
		.slice(0, 600);
}

function service(voiceType: number, speed: number): TencentTtsService {
	const config = getTtsProviderConfig();
	const secretId = config.tencentSecretId;
	const secretKey = config.tencentSecretKey;
	if (!secretId || !secretKey) {
		throw new Error('TENCENT_TTS_CREDENTIALS_MISSING');
	}
	return new TencentTtsService({
		credentials: {
			secretId,
			secretKey,
			securityToken: config.tencentSecurityToken || undefined,
		},
		region: config.tencentRegion || undefined,
		voiceType,
		speed,
		sampleRate: 16000,
		concurrency: Math.max(
			1,
			Math.min(6, Number(process.env.STORYBOARD_TTS_CHUNK_CONCURRENCY || '4')),
		),
		maxRetries: 2,
	});
}

export function createTtsPreviewMiddleware(): Connect.NextHandleFunction {
	return async (request, response) => {
		if (request.method !== 'POST') {
			return respond(response, 405, { error: 'METHOD_NOT_ALLOWED' });
		}
		if (!acceptsContentType(request, 'application/json')) {
			return respond(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
		}
		try {
			const input = (await readJson(request)) as {
				text?: unknown;
				voiceType?: unknown;
				speed?: unknown;
			};
			const text = typeof input.text === 'string' ? input.text.trim() : '';
			const voiceType = Number(input.voiceType ?? 101001);
			const speed = Number(input.speed ?? 0);
			if (!text || text.length > 4000) {
				return respond(response, 400, { error: 'INVALID_TEXT' });
			}
			if (!Number.isSafeInteger(voiceType) || !Number.isFinite(speed)) {
				return respond(response, 400, { error: 'INVALID_VOICE' });
			}
			const provider = getTtsProviderConfig().provider;
			if (provider === 'fake') {
				const durationMs = Math.max(700, Math.round(([...text].length / 5) * 1000));
				return respond(response, 200, {
					taskId: `fake-${Date.now()}`,
					durationMs,
					mimeType: 'audio/wav',
					audioBase64: makeToneWav(durationMs).toString('base64'),
					subtitles: [],
					segments: [],
				});
			}
			if (provider === 'edge') {
				const workDir = await mkdtemp(join(tmpdir(), 'storyboard-edge-preview-'));
				try {
					const taskId = `edge-${Date.now()}`;
					const result = await new EdgeTtsStoryboardSynthesizer().synthesize({
						taskId,
						clipId: 'preview',
						sourceShotId: 'preview',
						startMs: 0,
						startSample: 0,
						text,
						voiceType,
						speed,
						outputDir: workDir,
						signal: AbortSignal.timeout(60_000),
					});
					const audio = await readFile(result.audioPath!);
					return respond(response, 200, {
						taskId,
						provider: 'edge-tts',
						durationMs: result.durationMs,
						mimeType: 'audio/wav',
						audioBase64: audio.toString('base64'),
						subtitles: result.words,
						segments: [],
					});
				} finally {
					await rm(workDir, { recursive: true, force: true });
				}
			}
			if (provider === 'aliyun') {
				const workDir = await mkdtemp(join(tmpdir(), 'storyboard-aliyun-preview-'));
				try {
					const taskId = `aliyun-${Date.now()}`;
					const result = await new AliyunStoryboardSynthesizer().synthesize({
						taskId,
						clipId: 'preview',
						sourceShotId: 'preview',
						startMs: 0,
						startSample: 0,
						text,
						voiceType,
						speed,
						outputDir: workDir,
						signal: AbortSignal.timeout(60_000),
					});
					const audio = await readFile(result.audioPath!);
					return respond(response, 200, {
						taskId,
						provider: 'aliyun-compatible',
						durationMs: result.durationMs,
						mimeType: 'audio/wav',
						audioBase64: audio.toString('base64'),
						subtitles: result.words,
						segments: [],
					});
				} finally {
					await rm(workDir, { recursive: true, force: true });
				}
			}
			if (provider === 'local') {
				const workDir = await mkdtemp(join(tmpdir(), 'storyboard-tts-preview-'));
				try {
					const result = await synthesizeLocalWav(
						text,
						speed,
						join(workDir, 'preview.wav'),
						AbortSignal.timeout(60_000),
					);
					return respond(response, 200, {
						taskId: `local-${Date.now()}`,
						provider: 'local-espeak',
						durationMs: result.durationMs,
						mimeType: 'audio/wav',
						audioBase64: result.audio.toString('base64'),
						subtitles: [],
						segments: [],
					});
				} finally {
					await rm(workDir, { recursive: true, force: true });
				}
			}
			const result = await service(voiceType, speed).synthesize({ text });
			return respond(response, 200, {
				taskId: result.taskId,
				durationMs: result.durationMs,
				mimeType: result.mimeType,
				audioBase64: result.audio.toString('base64'),
				subtitles: result.subtitles,
				segments: result.segments.map((segment) => ({
					id: segment.id,
					requestId: segment.requestId,
					sessionId: segment.sessionId,
					durationMs: segment.durationMs,
				})),
			});
		} catch (error) {
			const detail = previewError(error);
			const code = ['TENCENT_TTS_CREDENTIALS_MISSING', 'ALIYUN_TTS_API_KEY_MISSING'].includes(
				detail,
			)
				? detail
				: detail || 'TTS_PREVIEW_FAILED';
			console.error('[storyboard-tts-preview] failed', { error: detail });
			return respond(response, code.endsWith('_MISSING') ? 503 : 500, {
				error: code,
			});
		}
	};
}
