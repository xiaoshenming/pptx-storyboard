export function polishGenerationProgress(done: number, total: number): number {
	return 5 + Math.round((Math.max(0, done) / Math.max(1, total)) * 40);
}

export function captureGenerationProgress(done: number, total: number): number {
	return 45 + Math.round((Math.max(0, done) / Math.max(1, total)) * 25);
}

export function serverGenerationProgress(progress: number): number {
	return 70 + Math.round((Math.max(0, Math.min(100, progress)) / 100) * 30);
}
