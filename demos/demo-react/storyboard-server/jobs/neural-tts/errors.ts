export type NeuralTtsErrorCode =
	| 'EDGE_TTS_CANCELLED'
	| 'EDGE_TTS_DEPENDENCY_MISSING'
	| 'EDGE_TTS_NETWORK_FAILED'
	| 'EDGE_TTS_OUTPUT_INVALID'
	| 'EDGE_TTS_PROCESS_FAILED'
	| 'EDGE_TTS_TIMEOUT';

export class NeuralTtsError extends Error {
	readonly code: NeuralTtsErrorCode;
	readonly cause?: unknown;

	constructor(code: NeuralTtsErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'NeuralTtsError';
		this.code = code;
		this.cause = cause;
	}
}
