import { describe, expect, it } from 'vitest';

import { normalizedConcurrency, runCapturePool } from './capture-pool';
import type { CapturePoolWorker } from './capture-pool';

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('runCapturePool', () => {
	it('reuses only the configured number of workers and preserves result order', async () => {
		const items = Array.from({ length: 149 }, (_, index) => index);
		let active = 0;
		let maxActive = 0;
		let created = 0;
		let disposed = 0;
		const completions: number[] = [];
		const createWorker = (): CapturePoolWorker<number, string> => {
			created += 1;
			return {
				async run(value) {
					active += 1;
					maxActive = Math.max(maxActive, active);
					await Promise.resolve();
					active -= 1;
					return `frame-${value}`;
				},
				dispose() {
					disposed += 1;
				},
			};
		};

		const result = await runCapturePool({
			items,
			concurrency: 149,
			createWorker,
			onComplete: (_output, index) => completions.push(index),
		});

		expect(result).toStrictEqual(items.map((value) => `frame-${value}`));
		expect(created).toBe(4);
		expect(disposed).toBe(4);
		expect(maxActive).toBe(4);
		expect(completions).toHaveLength(149);
	});

	it('stops scheduling after cancellation and disposes every worker', async () => {
		const controller = new AbortController();
		const gate = deferred();
		let started = 0;
		let disposed = 0;
		const reason = new Error('cancelled by caller');
		const promise = runCapturePool({
			items: [0, 1, 2, 3, 4, 5],
			concurrency: 2,
			signal: controller.signal,
			createWorker: () => ({
				async run(value) {
					started += 1;
					await gate.promise;
					return value;
				},
				dispose() {
					disposed += 1;
				},
			}),
		});

		await Promise.resolve();
		controller.abort(reason);
		gate.resolve();
		await expect(promise).rejects.toBe(reason);
		expect(started).toBe(2);
		expect(disposed).toBe(2);
	});

	it('waits for in-flight work before cleanup when one worker fails', async () => {
		const gate = deferred();
		let inFlight = 0;
		let disposedWhileRunning = false;
		const failure = new Error('capture failed');
		const promise = runCapturePool({
			items: [0, 1, 2],
			concurrency: 2,
			createWorker: () => ({
				async run(value) {
					inFlight += 1;
					try {
						if (value === 0) {
							throw failure;
						}
						await gate.promise;
						return value;
					} finally {
						inFlight -= 1;
					}
				},
				dispose() {
					disposedWhileRunning ||= inFlight > 0;
				},
			}),
		});

		await Promise.resolve();
		gate.resolve();
		await expect(promise).rejects.toBe(failure);
		expect(disposedWhileRunning).toBeFalsy();
	});
});

describe('normalizedConcurrency', () => {
	it('defaults to three, clamps to the item count, and rejects invalid values', () => {
		expect(normalizedConcurrency(undefined, 149)).toBe(3);
		expect(normalizedConcurrency(8, 2)).toBe(2);
		expect(normalizedConcurrency(149, 149)).toBe(4);
		expect(normalizedConcurrency(2.9, 8)).toBe(2);
		expect(normalizedConcurrency(undefined, 0)).toBe(0);
		expect(() => normalizedConcurrency(0, 1)).toThrow(RangeError);
		expect(() => normalizedConcurrency(Number.NaN, 1)).toThrow(RangeError);
	});
});
