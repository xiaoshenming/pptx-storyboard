import { TtsError } from './errors';
import { withTencentTtsSlot } from './global-gate';
import { asTtsTaskId, createTtsSegmentId, createTtsTaskId } from './ids';
import { mapConcurrent } from './pool';
import { mergeSubtitles } from './subtitles';
import { TencentTextToVoiceClient } from './tencent-client';
import { splitChineseText } from './text';
import type {
	TencentTtsConfig,
	TtsSegmentResult,
	TtsSynthesisRequest,
	TtsSynthesisResult,
} from './types';
import { getWavDurationMs, mergeWavSegments } from './wav';

const DEFAULT_VOICE_TYPE = 101001;

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
	if (!Number.isFinite(value) || value < minimum || value > maximum) {
		throw new TtsError(`${label} must be between ${minimum} and ${maximum}`, { kind: 'input' });
	}
	return value;
}

export class TencentTtsService {
	private readonly client: TencentTextToVoiceClient;

	constructor(private readonly config: TencentTtsConfig) {
		finiteRange(config.speed ?? 0, -2, 6, 'speed');
		finiteRange(config.volume ?? 0, -10, 10, 'volume');
		const concurrency = config.concurrency ?? 4;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20) {
			throw new TtsError('concurrency must be an integer between 1 and 20', { kind: 'input' });
		}
		this.client = new TencentTextToVoiceClient(config);
	}

	async synthesize(request: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
		const chunks = splitChineseText(request.text);
		const taskId = request.taskId
			? asTtsTaskId(request.taskId)
			: createTtsTaskId(
					JSON.stringify({
						text: request.text,
						voiceType: this.config.voiceType ?? DEFAULT_VOICE_TYPE,
						fastVoiceType: this.config.fastVoiceType ?? '',
						speed: this.config.speed ?? 0,
						volume: this.config.volume ?? 0,
						sampleRate: this.config.sampleRate ?? 16000,
						modelType: this.config.modelType ?? 1,
					}),
				);
		const responses = await mapConcurrent(chunks, this.config.concurrency ?? 4, (chunk, index) => {
			const segmentId = createTtsSegmentId(taskId, index);
			return withTencentTtsSlot(() =>
				this.client.textToVoice(
					{
						text: chunk.text,
						sessionId: segmentId,
						voiceType: this.config.voiceType ?? DEFAULT_VOICE_TYPE,
						fastVoiceType: this.config.fastVoiceType,
						speed: this.config.speed ?? 0,
						volume: this.config.volume ?? 0,
						sampleRate: this.config.sampleRate ?? 16000,
						projectId: this.config.projectId ?? 0,
						modelType: this.config.modelType ?? 1,
					},
					request.signal,
				),
			);
		});

		let elapsedMs = 0;
		const segments: TtsSegmentResult[] = [];
		const subtitleInputs = responses.map((response, index) => {
			const chunk = chunks[index];
			const durationMs = getWavDurationMs(response.audio);
			const startTimeMs = elapsedMs;
			elapsedMs += durationMs;
			const id = createTtsSegmentId(taskId, index);
			segments.push({
				id,
				index,
				text: chunk.text,
				requestId: response.requestId,
				sessionId: response.sessionId,
				durationMs,
				startTimeMs,
				endTimeMs: elapsedMs,
				startTextIndex: chunk.startIndex,
				endTextIndex: chunk.endIndex,
			});
			return {
				id,
				textStartIndex: chunk.startIndex,
				startTimeMs,
				subtitles: response.subtitles,
			};
		});

		return {
			taskId,
			audio: mergeWavSegments(responses.map((response) => response.audio)),
			mimeType: 'audio/wav',
			durationMs: elapsedMs,
			subtitles: mergeSubtitles(taskId, subtitleInputs),
			segments,
		};
	}
}
