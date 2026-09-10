import type { Plugin } from 'vite';

import { FakeStoryboardSynthesizer } from './storyboard-server/jobs/fake-synthesizer';
import { createStoryboardJobMiddleware } from './storyboard-server/jobs/job-api';
import { cleanupExpiredStoryboardJobs } from './storyboard-server/jobs/job-store';
import { LocalEspeakStoryboardSynthesizer } from './storyboard-server/jobs/local-espeak-synthesizer';
import { EdgeTtsStoryboardSynthesizer } from './storyboard-server/jobs/neural-tts';
import { TencentStoryboardSynthesizer } from './storyboard-server/jobs/tencent-synthesizer';
import {
	acceptsContentType,
	hasTrustedLocalOrigin,
	isLoopbackAddress,
} from './storyboard-server/request-security';
import { createTtsPreviewMiddleware } from './storyboard-server/tts/preview-api';

interface ScriptRequest {
	shot?: { label?: string; effectLabel?: string };
	slideTitle?: string;
	slideText?: string;
	speakerNotes?: string;
}

async function readBuffer(request: import('node:http').IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 64 * 1024) {
			throw new Error('REQUEST_TOO_LARGE');
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(body));
}

export function storyboardApi(): Plugin {
	return {
		name: 'storyboard-deepseek-api',
		configureServer(server) {
			void cleanupExpiredStoryboardJobs();
			const cleanupTimer = setInterval(() => void cleanupExpiredStoryboardJobs(), 15 * 60 * 1000);
			cleanupTimer.unref();
			server.httpServer?.once('close', () => clearInterval(cleanupTimer));
			const synthesizer =
				process.env.STORYBOARD_TTS_FAKE === '1'
					? new FakeStoryboardSynthesizer()
					: process.env.STORYBOARD_TTS_EDGE === '1'
						? new EdgeTtsStoryboardSynthesizer()
						: process.env.STORYBOARD_TTS_LOCAL === '1'
							? new LocalEspeakStoryboardSynthesizer()
							: new TencentStoryboardSynthesizer();
			server.middlewares.use('/api/storyboard', (request, response, next) => {
				if (isLoopbackAddress(request.socket.remoteAddress) && hasTrustedLocalOrigin(request)) {
					return next();
				}
				const expected = process.env.STORYBOARD_REMOTE_TOKEN?.trim();
				if (expected && request.headers['x-storyboard-token'] === expected) {
					return next();
				}
				return json(response, 403, { error: 'REMOTE_ACCESS_DENIED' });
			});
			server.middlewares.use('/api/storyboard/jobs', createStoryboardJobMiddleware(synthesizer));
			server.middlewares.use('/api/storyboard/tts', createTtsPreviewMiddleware());
			server.middlewares.use('/api/storyboard/generate', async (request, response) => {
				if (request.method !== 'POST') {
					return json(response, 405, { error: 'Method not allowed' });
				}
				if (!acceptsContentType(request, 'application/json')) {
					return json(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
				}
				const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
				if (!apiKey) {
					return json(response, 503, { error: 'DEEPSEEK_API_KEY is not configured' });
				}
				try {
					const input = JSON.parse((await readBuffer(request)).toString('utf8')) as ScriptRequest;
					for (const value of [input.slideTitle, input.slideText, input.speakerNotes]) {
						if (typeof value === 'string' && value.length > 8000) {
							throw new Error('INPUT_TOO_LONG');
						}
					}
					const prompt = [
						`分镜：${input.shot?.label ?? ''}`,
						`动画事件：${input.shot?.effectLabel ?? ''}`,
						`页面标题：${input.slideTitle ?? ''}`,
						`PPT备注：${input.speakerNotes ?? ''}`,
						`页面内容：${input.slideText ?? ''}`,
					].join('\n');
					const upstream = await fetch('https://api.deepseek.com/chat/completions', {
						method: 'POST',
						signal: AbortSignal.timeout(30_000),
						headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({
							model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
							temperature: 0.35,
							messages: [
								{
									role: 'system',
									content:
										'你是数学课程视频编导。根据当前PPT分镜写自然、准确、可直接配音的中文讲稿。只输出讲稿，不添加标题或说明；不要提前讲尚未出现的画面内容。',
								},
								{ role: 'user', content: prompt },
							],
						}),
					});
					if (!upstream.ok) {
						return json(response, 502, { error: `DeepSeek HTTP ${upstream.status}` });
					}
					const payload = (await upstream.json()) as {
						choices?: Array<{ message?: { content?: string } }>;
					};
					const script = payload.choices?.[0]?.message?.content?.trim();
					return script
						? json(response, 200, { script })
						: json(response, 502, { error: 'Empty response' });
				} catch {
					return json(response, 500, { error: 'SCRIPT_GENERATION_FAILED' });
				}
			});
		},
	};
}
