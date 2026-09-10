export interface CapturePoolWorker<TInput, TOutput> {
	run(input: TInput, index: number): Promise<TOutput>;
	dispose(): void | Promise<void>;
}

export const MAX_CAPTURE_CONCURRENCY = 4;

interface CapturePoolOptions<TInput, TOutput> {
	items: readonly TInput[];
	concurrency: number;
	signal?: AbortSignal;
	createWorker: (workerIndex: number) => CapturePoolWorker<TInput, TOutput>;
	onComplete?: (output: TOutput, index: number, completed: number) => void;
}

export function normalizedConcurrency(requested: number | undefined, itemCount: number): number {
	if (itemCount === 0) {
		return 0;
	}
	if (requested === undefined) {
		return Math.min(3, itemCount);
	}
	if (!Number.isFinite(requested) || requested < 1) {
		throw new RangeError('Storyboard capture concurrency must be a positive finite number');
	}
	return Math.min(Math.floor(requested), itemCount, MAX_CAPTURE_CONCURRENCY);
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('Storyboard capture aborted', 'AbortError');
}

export async function runCapturePool<TInput, TOutput>({
	items,
	concurrency,
	signal,
	createWorker,
	onComplete,
}: CapturePoolOptions<TInput, TOutput>): Promise<TOutput[]> {
	if (items.length === 0) {
		return [];
	}
	if (signal?.aborted) {
		throw abortReason(signal);
	}

	const workerCount = normalizedConcurrency(concurrency, items.length);
	const workers: Array<CapturePoolWorker<TInput, TOutput>> = [];
	const outputs = new Array<TOutput>(items.length);
	let nextIndex = 0;
	let completed = 0;
	let hasFailure = false;
	let failure: unknown;

	const runWorker = async (worker: CapturePoolWorker<TInput, TOutput>): Promise<void> => {
		while (true) {
			if (hasFailure || signal?.aborted) {
				break;
			}
			const index = nextIndex++;
			if (index >= items.length) {
				return;
			}
			try {
				const output = await worker.run(items[index], index);
				if (signal?.aborted) {
					hasFailure = true;
					failure = abortReason(signal);
					return;
				}
				outputs[index] = output;
				completed += 1;
				onComplete?.(output, index, completed);
			} catch (error) {
				if (!hasFailure) {
					hasFailure = true;
					failure = error;
				}
				return;
			}
		}
		if (signal?.aborted && !hasFailure) {
			hasFailure = true;
			failure = abortReason(signal);
		}
	};

	try {
		for (let index = 0; index < workerCount; index += 1) {
			workers.push(createWorker(index));
		}
		await Promise.all(workers.map(runWorker));
		if (hasFailure) {
			throw failure;
		}
		return outputs;
	} finally {
		await Promise.allSettled(workers.map((worker) => worker.dispose()));
	}
}
