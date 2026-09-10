import { cpus } from 'node:os';

import { mapConcurrent } from '../render/concurrency';
import { verifyVideoOutput } from '../render/output-verifier';
import { renderStoryboardVideo } from '../render/video-renderer';
import type { SynthesizedShotAudio } from '../render/video-renderer';
import { setStoryboardJobStage, updateStoryboardJob } from './job-store';
import type { StoryboardJob, StoryboardJobManifest, StoryboardRenderTask } from './job-types';

export interface StoryboardSynthesisInput {
	taskId: string;
	clipId: string;
	sourceShotId: string;
	startMs: number;
	startSample: number;
	text: string;
	voiceType: number;
	speed: number;
	outputDir: string;
	signal: AbortSignal;
}

export interface StoryboardSynthesizer {
	synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio>;
}

const runningControllers = new Map<string, AbortController>();

export function cancelRunningStoryboardJob(jobId: string): boolean {
	const controller = runningControllers.get(jobId);
	controller?.abort();
	return Boolean(controller);
}

function ttsConcurrency(): number {
	const configured = Number(process.env.STORYBOARD_TTS_CONCURRENCY || '0');
	if (Number.isFinite(configured) && configured > 0) {
		return Math.floor(configured);
	}
	return Math.max(2, Math.min(6, Math.floor(cpus().length / 3)));
}

function createTtsTask(
	job: StoryboardJob,
	clipId: string,
	sourceShotId: string,
): StoryboardRenderTask {
	const task: StoryboardRenderTask = {
		id: `${job.id}:tts:${clipId}`,
		kind: 'tts',
		shotId: sourceShotId,
		status: 'queued',
		progress: 0,
		attempt: 0,
	};
	job.tasks.push(task);
	return task;
}

function assertActive(job: StoryboardJob, controller: AbortController): void {
	if (!job.cancelRequested) {
		return;
	}
	controller.abort();
	throw new DOMException('Cancelled', 'AbortError');
}

export async function runStoryboardJob(
	job: StoryboardJob,
	manifest: StoryboardJobManifest,
	synthesizer: StoryboardSynthesizer,
): Promise<void> {
	const controller = new AbortController();
	runningControllers.set(job.id, controller);
	const startedAt = Date.now();
	const synthesisConcurrency = ttsConcurrency();
	try {
		setStoryboardJobStage(job, 'synthesizing');
		updateStoryboardJob(job, { progress: 5 });
		const ttsTasks = manifest.narrationClips.map((clip) =>
			createTtsTask(job, clip.id, clip.sourceShotId),
		);
		let synthesized = 0;
		const audio = await mapConcurrent(
			manifest.narrationClips,
			synthesisConcurrency,
			async (clip, index) => {
				assertActive(job, controller);
				const currentTask = ttsTasks[index];
				if (!clip.script.trim()) {
					currentTask.status = 'succeeded';
					currentTask.progress = 100;
					return {
						clipId: clip.id,
						sourceShotId: clip.sourceShotId,
						startMs: clip.startMs,
						startSample: clip.startSample,
						durationMs: 0,
						words: [],
					};
				}
				currentTask.status = 'running';
				currentTask.attempt += 1;
				try {
					const result = await synthesizer.synthesize({
						taskId: currentTask.id,
						clipId: clip.id,
						sourceShotId: clip.sourceShotId,
						startMs: clip.startMs,
						startSample: clip.startSample,
						text: clip.script,
						voiceType: manifest.voiceType,
						speed: manifest.speed,
						outputDir: job.workDir,
						signal: controller.signal,
					});
					currentTask.status = 'succeeded';
					currentTask.progress = 100;
					synthesized += 1;
					updateStoryboardJob(job, {
						progress:
							5 + Math.round((synthesized / Math.max(1, manifest.narrationClips.length)) * 40),
					});
					return result;
				} catch (error) {
					currentTask.status = controller.signal.aborted ? 'cancelled' : 'failed';
					currentTask.error = 'TTS_FAILED';
					throw error;
				}
			},
		);
		assertActive(job, controller);
		setStoryboardJobStage(job, 'rendering');
		updateStoryboardJob(job, { progress: 48 });
		const result = await renderStoryboardVideo(job, manifest, audio, controller.signal);
		assertActive(job, controller);
		const receipt = await verifyVideoOutput(
			result.videoPath,
			result.outputDurationMs,
			manifest.fps,
			controller.signal,
		);
		updateStoryboardJob(job, {
			stage: 'completed',
			progress: 100,
			outputPath: result.videoPath,
			subtitlePath: result.subtitlePath,
			execution: {
				encoder: result.encoder,
				renderConcurrency: result.renderConcurrency,
				ttsConcurrency: synthesisConcurrency,
				elapsedMs: Date.now() - startedAt,
				outputDurationMs: result.outputDurationMs,
				verifiedDurationMs: receipt.durationMs,
				outputBytes: receipt.bytes,
				outputSha256: receipt.sha256,
			},
		});
	} catch (error) {
		const cancelled = job.cancelRequested || controller.signal.aborted;
		for (const task of job.tasks) {
			if (task.status === 'queued' || task.status === 'running') {
				task.status = cancelled ? 'cancelled' : 'failed';
				task.error ??= cancelled ? 'TASK_CANCELLED' : 'TASK_INTERRUPTED';
			}
		}
		if (cancelled) {
			updateStoryboardJob(job, { stage: 'cancelled', error: '用户已取消任务' });
			return;
		}
		console.error('[storyboard-job] failed', {
			jobId: job.id,
			stage: job.stage,
			error,
		});
		updateStoryboardJob(job, {
			stage: 'failed',
			error: job.stage === 'synthesizing' ? 'TTS_FAILED' : 'VIDEO_RENDER_FAILED',
		});
	} finally {
		runningControllers.delete(job.id);
	}
}
