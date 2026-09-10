import type { TencentSubtitle, TtsSegmentId, TtsSubtitle, TtsTaskId } from './types';

export interface SubtitleSegment {
	id: TtsSegmentId;
	textStartIndex: number;
	startTimeMs: number;
	subtitles: readonly TencentSubtitle[];
}

export function mergeSubtitles(
	taskId: TtsTaskId,
	segments: readonly SubtitleSegment[],
): TtsSubtitle[] {
	return segments.flatMap((segment) =>
		segment.subtitles.map((subtitle) => ({
			taskId,
			segmentId: segment.id,
			text: subtitle.Text,
			beginTimeMs: segment.startTimeMs + subtitle.BeginTime,
			endTimeMs: segment.startTimeMs + subtitle.EndTime,
			beginIndex: segment.textStartIndex + subtitle.BeginIndex,
			endIndex: segment.textStartIndex + subtitle.EndIndex,
			phoneme: subtitle.Phoneme ?? null,
		})),
	);
}
