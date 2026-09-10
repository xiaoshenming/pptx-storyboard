import { describe, expect, it } from 'vitest';

import { TencentTtsService } from './service';
import { makePcmWav } from './test-utils';

function successResponse(sessionId: string, text: string): Response {
	const duration = text.length > 1 ? 1000 : 250;
	return new Response(
		JSON.stringify({
			Response: {
				Audio: makePcmWav(duration).toString('base64'),
				SessionId: sessionId,
				RequestId: `request-${text.length}`,
				Subtitles: [
					{
						Text: Array.from(text)[0],
						BeginTime: 10,
						EndTime: Math.min(200, duration),
						BeginIndex: 0,
						EndIndex: 1,
						Phoneme: null,
					},
				],
			},
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
}

describe('tencentTtsService', () => {
	it('runs chunks concurrently and merges audio, subtitles, and stable IDs in source order', async () => {
		let active = 0;
		let maximumActive = 0;
		const fetchMock = async (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			const body = JSON.parse(String(init?.body)) as { Text: string; SessionId: string };
			await new Promise<void>((resolve) => {
				setTimeout(resolve, body.Text.length > 1 ? 10 : 0);
			});
			active -= 1;
			return successResponse(body.SessionId, body.Text);
		};
		const service = new TencentTtsService({
			credentials: { secretId: 'id', secretKey: 'key' },
			fetch: fetchMock as typeof fetch,
			concurrency: 2,
		});
		const result = await service.synthesize({ text: '你'.repeat(151) });
		expect(maximumActive).toBe(2);
		expect(result.segments.map((segment) => segment.text.length)).toStrictEqual([150, 1]);
		expect(result.segments.map((segment) => segment.startTimeMs)).toStrictEqual([0, 1000]);
		expect(result.durationMs).toBe(1250);
		expect(
			result.subtitles.map((subtitle) => [subtitle.beginTimeMs, subtitle.beginIndex]),
		).toStrictEqual([
			[10, 0],
			[1010, 150],
		]);
		expect(result.segments[0].id).toBe(`${result.taskId}:segment:0000`);
		expect(result.audio.subarray(0, 4).toString()).toBe('RIFF');

		const repeated = await service.synthesize({ text: '你'.repeat(151) });
		expect(repeated.taskId).toBe(result.taskId);
		expect(repeated.segments.map((segment) => segment.id)).toStrictEqual(
			result.segments.map((segment) => segment.id),
		);
	});

	it('validates speed and concurrency before sending requests', () => {
		expect(
			() =>
				new TencentTtsService({
					credentials: { secretId: 'id', secretKey: 'key' },
					speed: 7,
				}),
		).toThrow('speed must be between -2 and 6');
	});
});
