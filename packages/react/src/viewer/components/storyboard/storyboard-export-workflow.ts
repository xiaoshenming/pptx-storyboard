import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { CanvasSize } from '../../types';
import { downloadBlob } from '../../utils/dom-helpers';
import { createStoryboardRenderJob, readStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';

interface StoryboardExportWorkflowInput {
	endpoint: string;
	fileName: string;
	shots: StoryboardShot[];
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	timeline: TimelineModel;
	voiceType: number;
	speed: number;
	/** 绑定模型修订号，透传到 manifest 顶层作为导出回执。 */
	bindingRevision?: number;
	/** 返回 true 时立即停止轮询与回调（例如工作台已卸载）。 */
	isDisposed?: () => boolean;
	onJob: (job: StoryboardJobProgress) => void;
	onStatus: (status: string) => void;
}

const TERMINAL_STAGES = ['completed', 'failed', 'cancelled'];
const ABORT_ERROR = '导出已中止';
const POLL_INTERVAL_MS = 500;

function ensureActive(input: StoryboardExportWorkflowInput): void {
	if (input.isDisposed?.()) {
		throw new Error(ABORT_ERROR);
	}
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
	ensureActive(input);
	const created = await createStoryboardRenderJob({
		endpoint: input.endpoint,
		fileName: input.fileName,
		shots: input.shots,
		slides: input.slides,
		templateElementsBySlideId: input.templateElementsBySlideId,
		canvasSize: input.canvasSize,
		width: 1920,
		height: 1080,
		voiceType: input.voiceType,
		speed: input.speed,
		timeline: input.timeline,
		bindingRevision: input.bindingRevision,
		onCaptureProgress: (done, total) => input.onStatus(`并行捕获分镜 ${done}/${total}`),
	});
	ensureActive(input);
	input.onJob(created);
	if (!created.jobToken) {
		throw new Error('任务访问令牌缺失');
	}
	let current = created;
	while (!TERMINAL_STAGES.includes(current.stage)) {
		ensureActive(input);
		await new Promise<void>((resolve) => {
			setTimeout(resolve, POLL_INTERVAL_MS);
		});
		ensureActive(input);
		current = {
			...(await readStoryboardRenderJob(input.endpoint, current.id, created.jobToken)),
			jobToken: created.jobToken,
		};
		ensureActive(input);
		input.onJob(current);
		input.onStatus(`${current.id.slice(0, 8)} · ${current.stage} · ${current.progress}%`);
	}
	if (current.stage !== 'completed' || !current.downloadUrl) {
		throw new Error(current.error || `任务${current.stage}`);
	}
	ensureActive(input);
	await downloadResult(current.downloadUrl, created.jobToken, 'ppt-storyboard.mp4');
	if (current.subtitleUrl) {
		ensureActive(input);
		await downloadResult(current.subtitleUrl, created.jobToken, 'ppt-storyboard.srt');
	}
	ensureActive(input);
	input.onStatus(`任务 ${current.id.slice(0, 8)} 已完成`);
	return current;
}
