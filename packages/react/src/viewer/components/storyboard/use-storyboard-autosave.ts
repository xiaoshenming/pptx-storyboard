import { useEffect, useState } from 'react';

import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import { saveStoryboardProject } from './storyboard-project-store';
import type { TimelineModel } from './timeline';

interface AutosaveInput {
	projectId: string;
	fileName: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	lastJob: StoryboardJobProgress | null;
}

export function useStoryboardAutosave(input: AutosaveInput): 'saving' | 'saved' {
	const [status, setStatus] = useState<'saving' | 'saved'>('saved');
	useEffect(() => {
		setStatus('saving');
		const timer = window.setTimeout(() => {
			saveStoryboardProject({
				schemaVersion: 1,
				projectId: input.projectId,
				fileName: input.fileName,
				updatedAt: new Date().toISOString(),
				shots: input.shots,
				timeline: input.timeline,
				lastJob: input.lastJob ?? undefined,
			});
			setStatus('saved');
		}, 300);
		return () => window.clearTimeout(timer);
	}, [input.fileName, input.lastJob, input.projectId, input.shots, input.timeline]);
	return status;
}
