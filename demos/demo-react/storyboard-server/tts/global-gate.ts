let active = 0;
const waiters: Array<() => void> = [];
let lastStartedAt = 0;

function concurrencyLimit(): number {
	const configured = Number(process.env.STORYBOARD_TTS_GLOBAL_CONCURRENCY || '8');
	return Math.max(1, Math.min(20, Number.isFinite(configured) ? Math.floor(configured) : 8));
}

function minimumIntervalMs(): number {
	const configured = Number(process.env.STORYBOARD_TTS_MIN_INTERVAL_MS || '0');
	return Math.max(0, Math.min(5000, Number.isFinite(configured) ? configured : 0));
}

async function acquire(): Promise<void> {
	if (active >= concurrencyLimit()) {
		await new Promise<void>((resolve) => {
			waiters.push(resolve);
		});
	}
	active += 1;
	const delay = Math.max(0, lastStartedAt + minimumIntervalMs() - Date.now());
	if (delay > 0) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, delay);
		});
	}
	lastStartedAt = Date.now();
}

function release(): void {
	active = Math.max(0, active - 1);
	waiters.shift()?.();
}

export async function withTencentTtsSlot<T>(worker: () => Promise<T>): Promise<T> {
	await acquire();
	try {
		return await worker();
	} finally {
		release();
	}
}

/**
 * The Alibaba Qwen audio endpoint has a much lower request quota than the
 * local chunking service. Keep its requests behind a separate gate so an
 * Alibaba job cannot consume the Tencent slots (or vice versa).
 */
let aliyunActive = 0;
const aliyunWaiters: Array<() => void> = [];
let aliyunLastStartedAt = 0;

function aliyunConcurrencyLimit(): number {
	const configured = Number(process.env.STORYBOARD_ALIYUN_TTS_CONCURRENCY || '3');
	return Math.max(1, Math.min(4, Number.isFinite(configured) ? Math.floor(configured) : 3));
}

function aliyunMinimumIntervalMs(): number {
	const configured = Number(process.env.STORYBOARD_ALIYUN_TTS_MIN_INTERVAL_MS || '150');
	return Math.max(0, Math.min(5000, Number.isFinite(configured) ? configured : 150));
}

async function acquireAliyun(): Promise<void> {
	if (aliyunActive >= aliyunConcurrencyLimit()) {
		await new Promise<void>((resolve) => {
			aliyunWaiters.push(resolve);
		});
	}
	aliyunActive += 1;
	const delay = Math.max(0, aliyunLastStartedAt + aliyunMinimumIntervalMs() - Date.now());
	if (delay > 0) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, delay);
		});
	}
	aliyunLastStartedAt = Date.now();
}

function releaseAliyun(): void {
	aliyunActive = Math.max(0, aliyunActive - 1);
	aliyunWaiters.shift()?.();
}

export async function withAliyunTtsSlot<T>(worker: () => Promise<T>): Promise<T> {
	await acquireAliyun();
	try {
		return await worker();
	} finally {
		releaseAliyun();
	}
}
