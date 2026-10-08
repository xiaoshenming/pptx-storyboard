/** Bound mounted tick labels; pixel/time mapping and drag accuracy remain unchanged. */
export function timelineRulerTicks(durationMs: number): number[] {
	if (!Number.isFinite(durationMs) || durationMs < 0) {
		return [0];
	}
	const end = Math.ceil(durationMs / 1000) + 1;
	const minimumStep = Math.max(1, Math.ceil(end / 998));
	const scale = 10 ** Math.floor(Math.log10(minimumStep));
	const step = [1, 2, 5, 10].map((n) => n * scale).find((n) => n >= minimumStep)!;
	return Array.from({ length: Math.ceil(end / step) + 1 }, (_, i) => i * step);
}
