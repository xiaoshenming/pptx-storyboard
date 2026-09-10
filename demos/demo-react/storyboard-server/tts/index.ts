export { TtsError, isRetryableApiCode, normalizeTtsError } from './errors';
export { asTtsSegmentId, asTtsTaskId, createTtsSegmentId, createTtsTaskId } from './ids';
export { mapConcurrent } from './pool';
export { TencentTtsService } from './service';
export { mergeSubtitles, type SubtitleSegment } from './subtitles';
export { signTc3, type Tc3SignInput } from './tc3';
export {
	TencentTextToVoiceClient,
	type TencentTextToVoiceClientOptions,
	type TextToVoiceInput,
} from './tencent-client';
export { splitChineseText, type TextChunk } from './text';
export type {
	TencentCredentials,
	TencentSubtitle,
	TencentTextToVoiceResult,
	TencentTtsConfig,
	TtsSegmentId,
	TtsSegmentResult,
	TtsSubtitle,
	TtsSynthesisRequest,
	TtsSynthesisResult,
	TtsTaskId,
} from './types';
export { getWavDurationMs, mergeWavSegments } from './wav';
