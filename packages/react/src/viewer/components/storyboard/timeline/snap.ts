import { clipEndMs } from './model';
import { pixelsToMilliseconds } from './time';
import type {
	TimelineClip,
	TimelineSnapOptions,
	TimelineSnapPoint,
	TimelineSnapResult,
	TimelineTrack,
} from './types';

export function collectClipSnapPoints(
	tracks: TimelineTrack[],
	excludedClipIds: ReadonlySet<string> = new Set(),
): TimelineSnapPoint[] {
	const points: TimelineSnapPoint[] = [{ timeMs: 0, type: 'origin' }];
	for (const clip of tracks.flatMap((track) => track.clips)) {
		if (excludedClipIds.has(clip.id)) {
			continue;
		}
		points.push({ timeMs: clip.startMs, type: 'clip-start', sourceId: clip.id });
		points.push({ timeMs: clipEndMs(clip), type: 'clip-end', sourceId: clip.id });
	}
	return points;
}

function gridCandidates(timeMs: number, gridMs: number): TimelineSnapPoint[] {
	if (gridMs <= 0) {
		return [];
	}
	const index = Math.round(timeMs / gridMs);
	return [-1, 0, 1].map((offset) => ({
		timeMs: Math.max(0, (index + offset) * gridMs),
		type: 'grid' as const,
	}));
}

export function snapTime(timeMs: number, options: TimelineSnapOptions): TimelineSnapResult {
	const proposed = Math.max(0, timeMs);
	if (options.enabled === false || options.pixelsPerSecond <= 0) {
		return { timeMs: proposed, deltaMs: proposed - timeMs };
	}
	const thresholdMs = pixelsToMilliseconds(options.thresholdPx ?? 8, options.pixelsPerSecond);
	const candidates = [...(options.points ?? []), ...gridCandidates(proposed, options.gridMs ?? 0)];
	let nearest: TimelineSnapPoint | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const point of candidates) {
		const distance = Math.abs(point.timeMs - proposed);
		if (distance < nearestDistance || (distance === nearestDistance && point.type !== 'grid')) {
			nearest = point;
			nearestDistance = distance;
		}
	}
	if (!nearest || nearestDistance > thresholdMs) {
		return { timeMs: proposed, deltaMs: proposed - timeMs };
	}
	return { timeMs: nearest.timeMs, deltaMs: nearest.timeMs - timeMs, point: nearest };
}

export function snapClipStart(
	clip: TimelineClip,
	proposedStartMs: number,
	options: TimelineSnapOptions,
): TimelineSnapResult {
	const startResult = snapTime(proposedStartMs, options);
	const endResult = snapTime(proposedStartMs + clip.durationMs, options);
	const startDistance = startResult.point
		? Math.abs(startResult.deltaMs)
		: Number.POSITIVE_INFINITY;
	const endDistance = endResult.point ? Math.abs(endResult.deltaMs) : Number.POSITIVE_INFINITY;
	return endDistance < startDistance
		? { ...endResult, timeMs: proposedStartMs + endResult.deltaMs }
		: startResult;
}
