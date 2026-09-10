export type TtsErrorKind = 'input' | 'network' | 'http' | 'api' | 'response';

export class TtsError extends Error {
	readonly kind: TtsErrorKind;
	readonly retryable: boolean;
	readonly code?: string;
	readonly status?: number;
	readonly requestId?: string;

	constructor(
		message: string,
		options: {
			kind: TtsErrorKind;
			retryable?: boolean;
			code?: string;
			status?: number;
			requestId?: string;
			cause?: unknown;
		},
	) {
		super(message, { cause: options.cause });
		this.name = 'TtsError';
		this.kind = options.kind;
		this.retryable = options.retryable ?? false;
		this.code = options.code;
		this.status = options.status;
		this.requestId = options.requestId;
	}
}

const RETRYABLE_API_CODES = new Set([
	'InternalError.ErrorGetRoute',
	'InternalError.ExceedMaxLimit',
	'InternalError.InternalError',
	'InternalError.NoResource',
	'LimitExceeded.AccessLimit',
]);

export function isRetryableApiCode(code: string): boolean {
	return RETRYABLE_API_CODES.has(code);
}

export function normalizeTtsError(error: unknown): TtsError {
	if (error instanceof TtsError) {
		return error;
	}
	return new TtsError(error instanceof Error ? error.message : 'Tencent TTS network failure', {
		kind: 'network',
		retryable: true,
		cause: error,
	});
}
