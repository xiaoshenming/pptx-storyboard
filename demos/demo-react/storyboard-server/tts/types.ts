export type TtsTaskId = string & { readonly __brand: 'TtsTaskId' };
export type TtsSegmentId = string & { readonly __brand: 'TtsSegmentId' };

export interface TencentCredentials {
	secretId: string;
	secretKey: string;
	securityToken?: string;
}

export interface TencentTtsConfig {
	credentials: TencentCredentials;
	region?: string;
	voiceType?: number;
	fastVoiceType?: string;
	speed?: number;
	volume?: number;
	sampleRate?: 8000 | 16000 | 24000;
	projectId?: number;
	modelType?: number;
	concurrency?: number;
	maxRetries?: number;
	retryBaseDelayMs?: number;
	endpoint?: string;
	fetch?: typeof fetch;
	now?: () => Date;
	sleep?: (milliseconds: number) => Promise<void>;
}

export interface TtsSubtitle {
	taskId: TtsTaskId;
	segmentId: TtsSegmentId;
	text: string;
	beginTimeMs: number;
	endTimeMs: number;
	beginIndex: number;
	endIndex: number;
	phoneme: string | null;
}

export interface TtsSegmentResult {
	id: TtsSegmentId;
	index: number;
	text: string;
	requestId: string;
	sessionId: string;
	durationMs: number;
	startTimeMs: number;
	endTimeMs: number;
	startTextIndex: number;
	endTextIndex: number;
}

export interface TtsSynthesisRequest {
	text: string;
	taskId?: TtsTaskId | string;
	signal?: AbortSignal;
}

export interface TtsSynthesisResult {
	taskId: TtsTaskId;
	audio: Buffer;
	mimeType: 'audio/wav';
	durationMs: number;
	subtitles: TtsSubtitle[];
	segments: TtsSegmentResult[];
}

export interface TencentSubtitle {
	Text: string;
	BeginTime: number;
	EndTime: number;
	BeginIndex: number;
	EndIndex: number;
	Phoneme?: string | null;
}

export interface TencentTextToVoiceResult {
	audio: Buffer;
	requestId: string;
	sessionId: string;
	subtitles: TencentSubtitle[];
}
