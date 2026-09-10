export const DEFAULT_FRAME_RATE = 30;

function finite(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback;
}

export function clampTime(
	timeMs: number,
	minimumMs = 0,
	maximumMs = Number.POSITIVE_INFINITY,
): number {
	return Math.min(Math.max(finite(timeMs), minimumMs), maximumMs);
}

export function millisecondsToPixels(timeMs: number, pixelsPerSecond: number): number {
	if (pixelsPerSecond <= 0) {
		return 0;
	}
	return (finite(timeMs) * pixelsPerSecond) / 1000;
}

export function pixelsToMilliseconds(pixels: number, pixelsPerSecond: number): number {
	if (pixelsPerSecond <= 0) {
		return 0;
	}
	return (finite(pixels) * 1000) / pixelsPerSecond;
}

export function millisecondsToFrame(timeMs: number, frameRate = DEFAULT_FRAME_RATE): number {
	if (frameRate <= 0) {
		return 0;
	}
	return Math.round((finite(timeMs) * frameRate) / 1000);
}

export function frameToMilliseconds(frame: number, frameRate = DEFAULT_FRAME_RATE): number {
	if (frameRate <= 0) {
		return 0;
	}
	return (finite(frame) * 1000) / frameRate;
}

export function quantizeToFrame(timeMs: number, frameRate = DEFAULT_FRAME_RATE): number {
	return frameToMilliseconds(millisecondsToFrame(timeMs, frameRate), frameRate);
}

export function formatTimelineTime(timeMs: number, frameRate = DEFAULT_FRAME_RATE): string {
	const safeMs = Math.max(0, finite(timeMs));
	const totalFrames = millisecondsToFrame(safeMs, frameRate);
	const frames = frameRate > 0 ? totalFrames % Math.round(frameRate) : 0;
	const totalSeconds = Math.floor(safeMs / 1000);
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3600);
	return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':');
}
