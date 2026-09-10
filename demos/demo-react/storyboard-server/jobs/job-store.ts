import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoryboardJob, StoryboardJobSnapshot, StoryboardJobStage } from './job-types';

const jobs = new Map<string, StoryboardJob>();
const persistChains = new Map<string, Promise<void>>();
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const STORE_ROOT = join(tmpdir(), 'pptx-storyboard-jobs-v1');
let hydratePromise: Promise<void> | undefined;

function now(): string {
	return new Date().toISOString();
}

export async function createStoryboardJob(): Promise<StoryboardJob> {
	await hydrateStoryboardJobs();
	const id = randomUUID();
	const workDir = join(STORE_ROOT, id);
	await mkdir(workDir, { recursive: true, mode: 0o700 });
	const timestamp = now();
	const job: StoryboardJob = {
		id,
		stage: 'queued',
		progress: 0,
		createdAt: timestamp,
		updatedAt: timestamp,
		workDir,
		tasks: [],
		cancelRequested: false,
		accessToken: randomUUID(),
	};
	jobs.set(id, job);
	schedulePersist(job);
	return job;
}

export async function getStoryboardJob(id: string): Promise<StoryboardJob | undefined> {
	await hydrateStoryboardJobs();
	return jobs.get(id);
}

export function updateStoryboardJob(
	job: StoryboardJob,
	updates: Partial<
		Pick<
			StoryboardJob,
			'stage' | 'progress' | 'outputPath' | 'subtitlePath' | 'error' | 'execution'
		>
	>,
): void {
	Object.assign(job, updates, { updatedAt: now() });
	schedulePersist(job);
}

export function setStoryboardJobStage(job: StoryboardJob, stage: StoryboardJobStage): void {
	updateStoryboardJob(job, { stage });
}

export function requestStoryboardJobCancel(job: StoryboardJob): void {
	job.cancelRequested = true;
	job.updatedAt = now();
	schedulePersist(job);
}

export function snapshotStoryboardJob(job: StoryboardJob): StoryboardJobSnapshot {
	const {
		workDir: _workDir,
		outputPath,
		subtitlePath,
		accessToken: _accessToken,
		...snapshot
	} = job;
	return {
		...snapshot,
		tasks: job.tasks.map((task) => ({ ...task })),
		downloadUrl:
			outputPath && job.stage === 'completed' ? `/api/storyboard/jobs/${job.id}/video` : undefined,
		subtitleUrl:
			subtitlePath && job.stage === 'completed'
				? `/api/storyboard/jobs/${job.id}/subtitle`
				: undefined,
	};
}

export async function cleanupExpiredStoryboardJobs(): Promise<void> {
	await hydrateStoryboardJobs();
	const cutoff = Date.now() - JOB_TTL_MS;
	for (const [id, job] of jobs) {
		if (['queued', 'preparing', 'synthesizing', 'rendering', 'muxing'].includes(job.stage)) {
			continue;
		}
		if (Date.parse(job.updatedAt) >= cutoff) {
			continue;
		}
		jobs.delete(id);
		persistChains.delete(id);
		await rm(job.workDir, { recursive: true, force: true });
	}
}

export async function discardStoryboardJob(job: StoryboardJob): Promise<void> {
	jobs.delete(job.id);
	await persistChains.get(job.id)?.catch(() => undefined);
	persistChains.delete(job.id);
	await rm(job.workDir, { recursive: true, force: true });
}

async function persistSnapshot(job: StoryboardJob, snapshot: string): Promise<void> {
	try {
		await mkdir(job.workDir, { recursive: true, mode: 0o700 });
		await chmod(job.workDir, 0o700);
		const temporaryPath = join(job.workDir, `.job-${randomUUID()}.tmp`);
		await writeFile(temporaryPath, snapshot, { mode: 0o600 });
		await rename(temporaryPath, join(job.workDir, 'job.json'));
	} catch (error) {
		console.error('[storyboard-job] persistence failed', {
			jobId: job.id,
			error,
		});
	}
}

function schedulePersist(job: StoryboardJob): void {
	const snapshot = JSON.stringify(job);
	const previous = persistChains.get(job.id) ?? Promise.resolve();
	persistChains.set(
		job.id,
		previous.then(() => persistSnapshot(job, snapshot)),
	);
}

export function hydrateStoryboardJobs(): Promise<void> {
	hydratePromise ??= (async () => {
		await mkdir(STORE_ROOT, { recursive: true, mode: 0o700 });
		await chmod(STORE_ROOT, 0o700);
		for (const entry of await readdir(STORE_ROOT, { withFileTypes: true })) {
			if (!entry.isDirectory() || !/^[0-9a-f-]+$/u.test(entry.name)) {
				continue;
			}
			try {
				const job = JSON.parse(
					await readFile(join(STORE_ROOT, entry.name, 'job.json'), 'utf8'),
				) as StoryboardJob;
				if (job.id !== entry.name || job.workDir !== join(STORE_ROOT, entry.name)) {
					continue;
				}
				if (!job.accessToken) {
					job.accessToken = randomUUID();
				}
				if (['queued', 'preparing', 'synthesizing', 'rendering', 'muxing'].includes(job.stage)) {
					job.stage = 'failed';
					job.error = 'SERVER_RESTARTED';
					job.updatedAt = now();
					schedulePersist(job);
				}
				jobs.set(job.id, job);
			} catch {
				// Ignore incomplete or corrupt job snapshots.
			}
		}
	})();
	return hydratePromise;
}
