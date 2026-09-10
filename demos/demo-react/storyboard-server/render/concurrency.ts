export async function mapConcurrent<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const laneCount = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
	await Promise.all(
		Array.from({ length: laneCount }, async () => {
			while (nextIndex < items.length) {
				const index = nextIndex++;
				results[index] = await worker(items[index], index);
			}
		}),
	);
	return results;
}
