import { describe, expect, it, vi } from 'vitest';

import { TtsError } from './errors';
import { TencentTextToVoiceClient } from './tencent-client';
import { makePcmWav } from './test-utils';

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

const input = {
	text: '你好',
	sessionId: 'task:segment:0000',
	voiceType: 101001,
	speed: 1,
	volume: 0,
	sampleRate: 16000 as const,
	projectId: 0,
	modelType: 1,
};

describe('tencentTextToVoiceClient', () => {
	it('sends a signed TextToVoice request and decodes the result', async () => {
		const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get('authorization')).toMatch(
				/^TC3-HMAC-SHA256 Credential=secret-id\/2023-11-14\/tts\/tc3_request/,
			);
			expect(headers.get('x-tc-action')).toBe('TextToVoice');
			expect(headers.get('x-tc-version')).toBe('2019-08-23');
			expect(headers.get('x-tc-token')).toBe('token');
			expect(JSON.parse(String(init?.body))).toMatchObject({
				Text: '你好',
				Codec: 'wav',
				EnableSubtitle: true,
			});
			return response({
				Response: {
					Audio: makePcmWav(100).toString('base64'),
					SessionId: input.sessionId,
					RequestId: 'request-1',
					Subtitles: [],
				},
			});
		});
		const client = new TencentTextToVoiceClient({
			credentials: { secretId: 'secret-id', secretKey: 'secret-key', securityToken: 'token' },
			fetch: fetchMock as typeof fetch,
			now: () => new Date(1_700_000_000_000),
		});
		const result = await client.textToVoice(input);
		expect(result.requestId).toBe('request-1');
		expect(result.audio.subarray(0, 4).toString()).toBe('RIFF');
	});

	it('retries transient API errors with exponential delays', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response({ Response: { Error: { Code: 'InternalError.NoResource', Message: 'busy' } } }),
			)
			.mockResolvedValueOnce(
				response({
					Response: {
						Audio: makePcmWav(10).toString('base64'),
						SessionId: input.sessionId,
						RequestId: 'request-2',
					},
				}),
			);
		const sleep = vi.fn(async () => undefined);
		const client = new TencentTextToVoiceClient({
			credentials: { secretId: 'id', secretKey: 'key' },
			fetch: fetchMock as typeof fetch,
			sleep,
			retryBaseDelayMs: 25,
		});
		await expect(client.textToVoice(input)).resolves.toMatchObject({ requestId: 'request-2' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(25);
	});

	it('does not retry authentication or input failures', async () => {
		const fetchMock = vi.fn(async () =>
			response({
				Response: {
					Error: { Code: 'AuthFailure.InvalidAuthorization', Message: 'bad signature' },
					RequestId: 'request-auth',
				},
			}),
		);
		const client = new TencentTextToVoiceClient({
			credentials: { secretId: 'id', secretKey: 'key' },
			fetch: fetchMock as typeof fetch,
			maxRetries: 3,
		});
		const error = await client.textToVoice(input).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TtsError);
		expect(error).toMatchObject({ kind: 'api', retryable: false, requestId: 'request-auth' });
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('rejects oversized direct requests before fetch', async () => {
		const fetchMock = vi.fn();
		const client = new TencentTextToVoiceClient({
			credentials: { secretId: 'id', secretKey: 'key' },
			fetch: fetchMock as typeof fetch,
		});
		await expect(client.textToVoice({ ...input, text: '字'.repeat(151) })).rejects.toMatchObject({
			kind: 'input',
			retryable: false,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
