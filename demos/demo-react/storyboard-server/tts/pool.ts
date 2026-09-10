export async function mapConcurrent<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new RangeError('concurrency must be a positive integer');
	}
	const results = new Array<R>(items.length);
	let cursor = 0;
	async function run(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
	return results;
}
