import { useEffect } from 'react';

import { readStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';

const terminalStages = new Set(['completed', 'failed', 'cancelled']);

export function isStoryboardJobActive(job: StoryboardJobProgress | null): boolean {
	return Boolean(job && !terminalStages.has(job.stage));
}

export function useStoryboardJobRecovery(
	endpoint: string | undefined,
	job: StoryboardJobProgress | null,
	onJob: (job: StoryboardJobProgress) => void,
): void {
	const jobId = job?.id;
	const jobToken = job?.jobToken;
	const jobStage = job?.stage;
	useEffect(() => {
		if (!endpoint || !jobId || !jobToken || !jobStage || terminalStages.has(jobStage)) {
			return;
		}
		let disposed = false;
		void (async () => {
			let currentStage = jobStage;
			while (!terminalStages.has(currentStage)) {
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 500);
				});
				if (disposed) {
					return;
				}
				const current = {
					...(await readStoryboardRenderJob(endpoint, jobId, jobToken)),
					jobToken,
				};
				currentStage = current.stage;
				onJob(current);
			}
		})().catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, [endpoint, jobId, jobStage, jobToken, onJob]);
}
