import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from '../../utils/dom-helpers';
import { runStoryboardExport } from './storyboard-export-workflow';
import { createStoryboardRenderJob, readStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';

vi.mock(import('../../utils/dom-helpers'), () => ({ downloadBlob: vi.fn() }));
vi.mock(import('./storyboard-job-client'), () => ({
	createStoryboardRenderJob: vi.fn(),
	readStoryboardRenderJob: vi.fn(),
}));

const ENDPOINT = 'https://jobs.example/api';

function jobProgress(overrides: Partial<StoryboardJobProgress> = {}): StoryboardJobProgress {
	return { id: 'job-1', stage: 'render', progress: 0, tasks: [], ...overrides };
}

type ExportInput = Parameters<typeof runStoryboardExport>[0];

function baseInput(overrides: Partial<ExportInput> = {}): ExportInput {
	return {
		endpoint: ENDPOINT,
		fileName: 'deck.pptx',
		shots: [],
		slides: [],
		templateElementsBySlideId: {},
		canvasSize: { width: 1280, height: 720 },
		timeline: { tracks: [], frameRate: 30, durationMs: 0 },
		voiceType: 101001,
		speed: 0,
		bindingRevision: 7,
		onJob: vi.fn(),
		onStatus: vi.fn(),
		...overrides,
	};
}

function stubDownloads(urls: string[]): void {
	const allowed = new Set(urls);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (request: string | URL | Request) => {
			const url = String(request);
			if (!allowed.has(url)) {
				throw new Error(`unexpected fetch: ${url}`);
			}
			return { ok: true, status: 200, blob: async () => new Blob(['payload']) };
		}),
	);
}

/**
 * 立即挂上 rejection 捕获器再推进 fake 时钟：轮询中的 rejection 不算
 * unhandled，断言也不必悬挂未 await 的异步 expect。
 */
async function rejectionOf(promise: Promise<unknown>, advanceMs: number): Promise<unknown> {
	let reason: unknown;
	const guard = promise.catch((error: unknown) => {
		reason = error;
	});
	await vi.advanceTimersByTimeAsync(advanceMs);
	await guard;
	return reason;
}

describe('runStoryboardExport', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('polls until completed, then downloads video and subtitles', async () => {
		vi.mocked(createStoryboardRenderJob).mockResolvedValue(
			jobProgress({ stage: 'capturing', jobToken: 'tok-1' }),
		);
		vi.mocked(readStoryboardRenderJob)
			.mockResolvedValueOnce(jobProgress({ stage: 'rendering', progress: 40 }))
			.mockResolvedValueOnce(
				jobProgress({
					stage: 'completed',
					progress: 100,
					downloadUrl: 'https://cdn/output.mp4',
					subtitleUrl: 'https://cdn/sub.srt',
				}),
			);
		stubDownloads(['https://cdn/output.mp4', 'https://cdn/sub.srt']);
		const onJob = vi.fn();
		const onStatus = vi.fn();

		const promise = runStoryboardExport(baseInput({ onJob, onStatus }));
		await vi.advanceTimersByTimeAsync(500);
		await vi.advanceTimersByTimeAsync(500);
		const result = await promise;

		expect(result.stage).toBe('completed');
		// 轮询结果始终回填创建时下发的 jobToken。
		expect(result.jobToken).toBe('tok-1');
		expect(vi.mocked(readStoryboardRenderJob)).toHaveBeenCalledWith(ENDPOINT, 'job-1', 'tok-1');
		expect(onJob.mock.calls.map((call) => (call[0] as StoryboardJobProgress).stage)).toStrictEqual([
			'capturing',
			'rendering',
			'completed',
		]);
		expect(vi.mocked(downloadBlob).mock.calls.map((call) => call[1])).toStrictEqual([
			'ppt-storyboard.mp4',
			'ppt-storyboard.srt',
		]);
		expect(onStatus).toHaveBeenLastCalledWith('任务 job-1 已完成');
	});

	it('throws the job error when the render fails', async () => {
		vi.mocked(createStoryboardRenderJob).mockResolvedValue(
			jobProgress({ stage: 'queued', jobToken: 'tok-1' }),
		);
		vi.mocked(readStoryboardRenderJob).mockResolvedValue(
			jobProgress({ stage: 'failed', progress: 10, error: '编码失败' }),
		);
		const promise = runStoryboardExport(baseInput());
		const reason = await rejectionOf(promise, 500);
		expect((reason as Error).message).toBe('编码失败');
		expect(downloadBlob).not.toHaveBeenCalled();
	});

	it('throws for a cancelled job without a download', async () => {
		vi.mocked(createStoryboardRenderJob).mockResolvedValue(
			jobProgress({ stage: 'queued', jobToken: 'tok-1' }),
		);
		vi.mocked(readStoryboardRenderJob).mockResolvedValue(jobProgress({ stage: 'cancelled' }));
		const promise = runStoryboardExport(baseInput());
		const reason = await rejectionOf(promise, 500);
		expect((reason as Error).message).toBe('任务cancelled');
	});

	it('throws when the created job has no job token', async () => {
		vi.mocked(createStoryboardRenderJob).mockResolvedValue(jobProgress({ stage: 'capturing' }));
		const onJob = vi.fn();
		await expect(runStoryboardExport(baseInput({ onJob }))).rejects.toThrow('任务访问令牌缺失');
		expect(onJob).toHaveBeenCalledOnce();
		expect(readStoryboardRenderJob).not.toHaveBeenCalled();
	});

	it('aborts before creating the job when already disposed', async () => {
		await expect(runStoryboardExport(baseInput({ isDisposed: () => true }))).rejects.toThrow(
			'导出已中止',
		);
		expect(createStoryboardRenderJob).not.toHaveBeenCalled();
	});

	it('stops polling and callbacks once disposed mid-flight', async () => {
		vi.mocked(createStoryboardRenderJob).mockResolvedValue(
			jobProgress({ stage: 'render', jobToken: 'tok-1' }),
		);
		let disposed = false;
		const onJob = vi.fn();
		// 第一次轮询返回后工作台才被关闭：结果不得回调，且不再继续轮询。
		vi.mocked(readStoryboardRenderJob).mockImplementation(async () => {
			disposed = true;
			return jobProgress({ stage: 'rendering', progress: 40 });
		});
		const promise = runStoryboardExport(baseInput({ isDisposed: () => disposed, onJob }));
		const reason = await rejectionOf(promise, 500);
		expect((reason as Error).message).toBe('导出已中止');
		expect(readStoryboardRenderJob).toHaveBeenCalledOnce();
		expect(onJob).toHaveBeenCalledOnce(); // 仅 created，轮询结果被丢弃
	});
});
