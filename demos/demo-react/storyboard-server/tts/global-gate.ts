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
