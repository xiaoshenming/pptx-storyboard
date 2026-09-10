import { TtsError, isRetryableApiCode, normalizeTtsError } from './errors';
import { signTc3 } from './tc3';
import type { TencentCredentials, TencentSubtitle, TencentTextToVoiceResult } from './types';

const VERSION = '2019-08-23';

export interface TextToVoiceInput {
	text: string;
	sessionId: string;
	voiceType: number;
	fastVoiceType?: string;
	speed: number;
	volume: number;
	sampleRate: 8000 | 16000 | 24000;
	projectId: number;
	modelType: number;
}

export interface TencentTextToVoiceClientOptions {
	credentials: TencentCredentials;
	region?: string;
	endpoint?: string;
	maxRetries?: number;
	retryBaseDelayMs?: number;
	fetch?: typeof fetch;
	now?: () => Date;
	sleep?: (milliseconds: number) => Promise<void>;
}

interface TencentPayload {
	Response?: {
		Audio?: string;
		SessionId?: string;
		Subtitles?: TencentSubtitle[];
		RequestId?: string;
		Error?: { Code?: string; Message?: string };
	};
}

export class TencentTextToVoiceClient {
	private readonly endpoint: URL;
	private readonly fetchImpl: typeof fetch;
	private readonly now: () => Date;
	private readonly sleep: (milliseconds: number) => Promise<void>;

	constructor(private readonly options: TencentTextToVoiceClientOptions) {
		if (!options.credentials.secretId.trim() || !options.credentials.secretKey.trim()) {
			throw new TtsError('Tencent Cloud credentials must not be empty', { kind: 'input' });
		}
		this.endpoint = new URL(options.endpoint ?? 'https://tts.tencentcloudapi.com');
		if (this.endpoint.protocol !== 'https:') {
			throw new TtsError('Tencent TTS endpoint must use HTTPS', { kind: 'input' });
		}
		if (!Number.isSafeInteger(options.maxRetries ?? 2) || (options.maxRetries ?? 2) < 0) {
			throw new TtsError('maxRetries must be a non-negative integer', { kind: 'input' });
		}
		if (
			!Number.isFinite(options.retryBaseDelayMs ?? 200) ||
			(options.retryBaseDelayMs ?? 200) < 0
		) {
			throw new TtsError('retryBaseDelayMs must be non-negative', { kind: 'input' });
		}
		this.fetchImpl = options.fetch ?? fetch;
		this.now = options.now ?? (() => new Date());
		this.sleep =
			options.sleep ??
			((milliseconds) =>
				new Promise<void>((resolve) => {
					setTimeout(resolve, milliseconds);
				}));
	}

	async textToVoice(
		input: TextToVoiceInput,
		signal?: AbortSignal,
	): Promise<TencentTextToVoiceResult> {
		this.validateInput(input);
		const retries = this.options.maxRetries ?? 2;
		let lastError: TtsError | undefined;
		for (let attempt = 0; attempt <= retries; attempt += 1) {
			try {
				return await this.request(input, signal);
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
				lastError = normalizeTtsError(error);
				if (!lastError.retryable || attempt === retries) {
					throw lastError;
				}
				const base = this.options.retryBaseDelayMs ?? 200;
				await this.sleep(base * 2 ** attempt);
			}
		}
		throw lastError ?? new TtsError('Tencent TTS request failed', { kind: 'network' });
	}

	private validateInput(input: TextToVoiceInput): void {
		const textLength = Array.from(input.text).length;
		if (!input.text.trim() || textLength > 150) {
			throw new TtsError('TextToVoice text must contain 1-150 Unicode characters', {
				kind: 'input',
			});
		}
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.sessionId)) {
			throw new TtsError('TextToVoice sessionId must be 1-128 safe ASCII characters', {
				kind: 'input',
			});
		}
		if (!Number.isInteger(input.voiceType) || input.voiceType < 0) {
			throw new TtsError('TextToVoice voiceType must be a non-negative integer', {
				kind: 'input',
			});
		}
		if (!Number.isFinite(input.speed) || input.speed < -2 || input.speed > 6) {
			throw new TtsError('TextToVoice speed must be between -2 and 6', { kind: 'input' });
		}
		if (!Number.isFinite(input.volume) || input.volume < -10 || input.volume > 10) {
			throw new TtsError('TextToVoice volume must be between -10 and 10', { kind: 'input' });
		}
	}

	private async request(
		input: TextToVoiceInput,
		signal?: AbortSignal,
	): Promise<TencentTextToVoiceResult> {
		const body = JSON.stringify({
			Text: input.text,
			SessionId: input.sessionId,
			Volume: input.volume,
			Speed: input.speed,
			ProjectId: input.projectId,
			ModelType: input.modelType,
			VoiceType: input.voiceType,
			...(input.fastVoiceType ? { FastVoiceType: input.fastVoiceType } : {}),
			PrimaryLanguage: 1,
			SampleRate: input.sampleRate,
			Codec: 'wav',
			EnableSubtitle: true,
		});
		const timestamp = Math.floor(this.now().getTime() / 1000);
		const authorization = signTc3({
			payload: body,
			secretId: this.options.credentials.secretId,
			secretKey: this.options.credentials.secretKey,
			timestamp,
			host: this.endpoint.host,
		});
		let response: Response;
		try {
			response = await this.fetchImpl(this.endpoint, {
				method: 'POST',
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
					: AbortSignal.timeout(20_000),
				headers: {
					Authorization: authorization,
					'Content-Type': 'application/json; charset=utf-8',
					Host: this.endpoint.host,
					'X-TC-Action': 'TextToVoice',
					'X-TC-Timestamp': String(timestamp),
					'X-TC-Version': VERSION,
					...(this.options.region ? { 'X-TC-Region': this.options.region } : {}),
					...(this.options.credentials.securityToken
						? { 'X-TC-Token': this.options.credentials.securityToken }
						: {}),
				},
				body,
			});
		} catch (error) {
			throw normalizeTtsError(error);
		}
		if (!response.ok) {
			throw new TtsError(`Tencent TTS HTTP ${response.status}`, {
				kind: 'http',
				status: response.status,
				retryable: response.status === 429 || response.status >= 500,
			});
		}
		let payload: TencentPayload;
		try {
			payload = (await response.json()) as TencentPayload;
		} catch (error) {
			throw new TtsError('Tencent TTS returned invalid JSON', { kind: 'response', cause: error });
		}
		const result = payload.Response;
		if (result?.Error?.Code) {
			throw new TtsError(result.Error.Message ?? result.Error.Code, {
				kind: 'api',
				code: result.Error.Code,
				requestId: result.RequestId,
				retryable: isRetryableApiCode(result.Error.Code),
			});
		}
		if (!result?.Audio || !result.RequestId || !result.SessionId) {
			throw new TtsError('Tencent TTS response is missing audio or identifiers', {
				kind: 'response',
				requestId: result?.RequestId,
			});
		}
		return {
			audio: Buffer.from(result.Audio, 'base64'),
			requestId: result.RequestId,
			sessionId: result.SessionId,
			subtitles: result.Subtitles ?? [],
		};
	}
}
