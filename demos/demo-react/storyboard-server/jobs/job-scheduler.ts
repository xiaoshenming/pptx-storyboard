import { runStoryboardJob } from './job-runner';
import type { StoryboardSynthesizer } from './job-runner';
import { updateStoryboardJob } from './job-store';
import type { StoryboardJob, StoryboardJobManifest } from './job-types';

interface QueueEntry {
	job: StoryboardJob;
	manifest: StoryboardJobManifest;
	synthesizer: StoryboardSynthesizer;
}

const queue: QueueEntry[] = [];
let active = 0;

function concurrency(): number {
	const value = Number(process.env.STORYBOARD_JOB_CONCURRENCY || '1');
	return Math.max(1, Math.min(3, Number.isFinite(value) ? Math.floor(value) : 1));
}

function launch(entry: QueueEntry): void {
	active += 1;
	void runStoryboardJob(entry.job, entry.manifest, entry.synthesizer).finally(() => {
		active -= 1;
		drain();
	});
}

function drain(): void {
	while (active < concurrency() && queue.length > 0) {
		const entry = queue.shift()!;
		if (entry.job.cancelRequested) {
			updateStoryboardJob(entry.job, { stage: 'cancelled', error: '用户已取消任务' });
			continue;
		}
		launch(entry);
	}
}

export function canEnqueueStoryboardJob(): boolean {
	return queue.length < 10;
}

export function enqueueStoryboardJob(
	job: StoryboardJob,
	manifest: StoryboardJobManifest,
	synthesizer: StoryboardSynthesizer,
): void {
	if (!canEnqueueStoryboardJob()) {
		throw new Error('JOB_QUEUE_FULL');
	}
	queue.push({ job, manifest, synthesizer });
	drain();
}
