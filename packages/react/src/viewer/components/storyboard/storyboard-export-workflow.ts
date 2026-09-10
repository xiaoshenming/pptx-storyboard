import { downloadBlob } from '../../utils/dom-helpers';
import { createStoryboardRenderJob, readStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';

interface StoryboardExportWorkflowInput {
	endpoint: string;
	fileName: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	voiceType: number;
	speed: number;
	onJob: (job: StoryboardJobProgress) => void;
	onStatus: (status: string) => void;
}

async function downloadResult(url: string, jobToken: string, fileName: string): Promise<void> {
	const response = await fetch(url, { headers: { 'X-Storyboard-Job-Token': jobToken } });
	if (!response.ok) {
		throw new Error(`下载产物失败：HTTP ${response.status}`);
	}
	downloadBlob(await response.blob(), fileName);
}

export async function runStoryboardExport(
	input: StoryboardExportWorkflowInput,
): Promise<StoryboardJobProgress> {
	const stageElements = Array.from(
		document.querySelectorAll<HTMLElement>('[data-storyboard-export-shot]'),
	);
	const created = await createStoryboardRenderJob({
		endpoint: input.endpoint,
		fileName: input.fileName,
		shots: input.shots,
		stageElements,
		width: 1920,
		height: 1080,
		voiceType: input.voiceType,
		speed: input.speed,
		timeline: input.timeline,
		onCaptureProgress: (done, total) => input.onStatus(`并行捕获分镜 ${done}/${total}`),
	});
	input.onJob(created);
	if (!created.jobToken) {
		throw new Error('任务访问令牌缺失');
	}
	let current = created;
	while (!['completed', 'failed', 'cancelled'].includes(current.stage)) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 500);
		});
		current = {
			...(await readStoryboardRenderJob(input.endpoint, current.id, created.jobToken)),
			jobToken: created.jobToken,
		};
		input.onJob(current);
		input.onStatus(`${current.id.slice(0, 8)} · ${current.stage} · ${current.progress}%`);
	}
	if (current.stage !== 'completed' || !current.downloadUrl) {
		throw new Error(current.error || `任务${current.stage}`);
	}
	await downloadResult(current.downloadUrl, created.jobToken, 'ppt-storyboard.mp4');
	if (current.subtitleUrl) {
		await downloadResult(current.subtitleUrl, created.jobToken, 'ppt-storyboard.srt');
	}
	input.onStatus(`任务 ${current.id.slice(0, 8)} 已完成`);
	return current;
}
