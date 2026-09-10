import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface FrameRun {
	framePath: string;
	frameCount: number;
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
}

async function frameDigest(
	framePath: string,
	cache: Map<string, string>,
	signal?: AbortSignal,
): Promise<string> {
	const absolutePath = resolve(framePath);
	const cached = cache.get(absolutePath);
	if (cached) {
		return cached;
	}
	assertNotAborted(signal);
	const contents = await readFile(absolutePath);
	assertNotAborted(signal);
	const digest = createHash('sha256').update(contents).digest('hex');
	cache.set(absolutePath, digest);
	return digest;
}

export async function buildFrameRuns(
	framePaths: readonly string[],
	optimizeStaticHolds: boolean,
	signal?: AbortSignal,
): Promise<FrameRun[]> {
	if (!optimizeStaticHolds) {
		return framePaths.map((framePath) => ({ framePath: resolve(framePath), frameCount: 1 }));
	}
	const digestCache = new Map<string, string>();
	const runs: FrameRun[] = [];
	let previousDigest: string | undefined;
	for (const framePath of framePaths) {
		const digest = await frameDigest(framePath, digestCache, signal);
		const previous = runs.at(-1);
		if (previous && digest === previousDigest) {
			previous.frameCount += 1;
		} else {
			runs.push({ framePath: resolve(framePath), frameCount: 1 });
			previousDigest = digest;
		}
	}
	return runs;
}
