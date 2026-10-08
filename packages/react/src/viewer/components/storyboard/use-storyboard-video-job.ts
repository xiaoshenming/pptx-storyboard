import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import { useEffect, useRef, useState } from 'react';

import type { CanvasSize } from '../../types';
import { runStoryboardExport } from './storyboard-export-workflow';
import { cancelStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';
import { useStoryboardJobRecovery } from './use-storyboard-job-recovery';

interface VideoJobOptions {
	endpoint?: string;
	fileName?: string;
	shots: StoryboardShot[];
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	timeline: TimelineModel;
	voiceType: number;
	speed: number;
	initialJob?: StoryboardJobProgress | null;
	initialStatus?: string;
}

export function useStoryboardVideoJob(options: VideoJobOptions) {
	const [job, setJob] = useState<StoryboardJobProgress | null>(options.initialJob ?? null);
	const [exporting, setExporting] = useState(false);
	const [status, setStatus] = useState(options.initialStatus ?? '');
	const disposedRef = useRef(false);
	useEffect(() => () => void (disposedRef.current = true), []);
	useStoryboardJobRecovery(options.endpoint, job, setJob);
	return {
		job,
		setJob,
		exporting,
		status,
		generate: async (bindingRevision: number) => {
			if (exporting || !options.endpoint) {
				return;
			}
			setExporting(true);
			try {
				await runStoryboardExport({
					...options,
					endpoint: options.endpoint,
					fileName: options.fileName || 'presentation.pptx',
					bindingRevision,
					isDisposed: () => disposedRef.current,
					onJob: setJob,
					onStatus: setStatus,
				});
			} catch (error) {
				setStatus(error instanceof Error ? error.message : '视频生成失败');
			} finally {
				setExporting(false);
			}
		},
		cancel: async () => {
			if (!options.endpoint || !job?.jobToken) {
				return;
			}
			await cancelStoryboardRenderJob(options.endpoint, job.id, job.jobToken);
			setStatus(`正在取消任务 ${job.id.slice(0, 8)}`);
		},
	};
}
