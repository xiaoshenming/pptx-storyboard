import JSZip from 'jszip';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { CanvasSize } from '../../types';
import { captureStoryboardShotsAsPng } from './capture';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineBinding, TimelineModel } from './timeline';
import { millisecondsToFrame } from './timeline';

export interface StoryboardJobProgress {
	id: string;
	stage: string;
	progress: number;
	downloadUrl?: string;
	subtitleUrl?: string;
	jobToken?: string;
	error?: string;
	tasks: Array<{
		id: string;
		kind: string;
		shotId?: string;
		status: string;
		progress: number;
	}>;
	execution?: {
		encoder: 'h264_nvenc' | 'libx264';
		renderConcurrency: number;
		ttsConcurrency: number;
		ttsProvider?: string;
		elapsedMs: number;
		outputDurationMs: number;
		verifiedDurationMs?: number;
		outputBytes?: number;
		outputSha256?: string;
	};
}

// manifest 协议版本保持 1 不变：binding / resolvedStartMs / bindingRevision
// 都是向后兼容的可选回执字段，undefined 值经 JSON.stringify 丢键，
// 服务端按 version 1 宽松解析（逐字段校验、忽略未知键），因此无需升版。
const MANIFEST_VERSION = 1 as const;
const MANIFEST_FPS = 30;

export interface StoryboardManifestShot {
	id: string;
	frameFile: string;
	previousFrameFile?: string;
	transitionMs?: number;
	startMs: number;
	durationMs: number;
	startFrame: number;
	frameCount: number;
	script: string;
	subtitlesEnabled: boolean;
}

export interface StoryboardManifestNarrationClip {
	id: string;
	sourceShotId: string;
	startMs: number;
	startSample: number;
	durationMs: number;
	script: string;
	/**
	 * 显式绑定回执：解释该旁白为何落在 resolvedStartMs。
	 * 无绑定时键值为 undefined，JSON.stringify 会丢键，即"无绑定"语义。
	 */
	binding?: TimelineBinding;
	/** 解析后的绝对时间回执，与 startMs 相等。 */
	resolvedStartMs: number;
}

export interface StoryboardManifest {
	version: typeof MANIFEST_VERSION;
	fileName: string;
	width: number;
	height: number;
	fps: number;
	voiceType: number;
	speed: number;
	/** 绑定模型修订号回执；未提供时 JSON.stringify 丢键，服务端无感。 */
	bindingRevision?: number;
	shots: StoryboardManifestShot[];
	narrationClips: StoryboardManifestNarrationClip[];
}

export interface StoryboardManifestInput {
	fileName: string;
	width: number;
	height: number;
	voiceType: number;
	speed: number;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	bindingRevision?: number;
}

export function buildStoryboardManifest(input: StoryboardManifestInput): StoryboardManifest {
	const visualBySource = new Map(
		(input.timeline.tracks.find((track) => track.kind === 'visual')?.clips ?? []).map((clip) => [
			clip.sourceId,
			clip,
		]),
	);
	return {
		version: MANIFEST_VERSION,
		fileName: input.fileName,
		width: input.width,
		height: input.height,
		fps: MANIFEST_FPS,
		voiceType: input.voiceType,
		speed: input.speed,
		bindingRevision: input.bindingRevision,
		shots: input.shots.map((shot, index) => {
			const visual = visualBySource.get(shot.id);
			return {
				id: shot.id,
				frameFile: `frames/${String(index).padStart(5, '0')}.png`,
				previousFrameFile:
					shot.kind === 'animation' && index > 0
						? `frames/${String(index - 1).padStart(5, '0')}.png`
						: undefined,
				transitionMs:
					shot.kind === 'animation'
						? Math.min(
								1200,
								Math.max(150, ...(shot.animationEvents ?? []).map((event) => event.durationMs)),
							)
						: undefined,
				startMs: visual?.startMs ?? 0,
				durationMs: visual?.durationMs ?? shot.durationMs,
				startFrame: millisecondsToFrame(visual?.startMs ?? 0, MANIFEST_FPS),
				frameCount: Math.max(
					1,
					millisecondsToFrame(visual?.durationMs ?? shot.durationMs, MANIFEST_FPS),
				),
				script: shot.script,
				subtitlesEnabled: shot.subtitlesEnabled ?? true,
			};
		}),
		narrationClips:
			input.timeline.tracks
				.find((track) => track.kind === 'narration')
				?.clips.filter((clip) => clip.script?.text.trim())
				.map((clip) => ({
					id: clip.id,
					sourceShotId: clip.sourceId || '',
					startMs: clip.startMs,
					startSample: Math.round((clip.startMs / 1000) * 48_000),
					durationMs: clip.durationMs,
					script: clip.script?.text.trim() || '',
					binding: clip.binding,
					resolvedStartMs: clip.startMs,
				})) ?? [],
	};
}

interface CreateJobInput {
	endpoint: string;
	fileName: string;
	shots: StoryboardShot[];
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	width: number;
	height: number;
	voiceType: number;
	speed: number;
	timeline: TimelineModel;
	/** 绑定模型修订号，透传到 manifest 顶层作为回执。 */
	bindingRevision?: number;
	onCaptureProgress?: (done: number, total: number) => void;
}

export async function createStoryboardRenderJob(
	input: CreateJobInput,
): Promise<StoryboardJobProgress> {
	const frames = await captureStoryboardShotsAsPng({
		shots: input.shots,
		slides: input.slides,
		templateElementsBySlideId: input.templateElementsBySlideId,
		canvasSize: input.canvasSize,
		concurrency: 4,
		onProgress: ({ completed, total }) => input.onCaptureProgress?.(completed, total),
	});
	const zip = new JSZip();
	const manifest = buildStoryboardManifest({
		fileName: input.fileName,
		width: input.width,
		height: input.height,
		voiceType: input.voiceType,
		speed: input.speed,
		shots: input.shots,
		timeline: input.timeline,
		bindingRevision: input.bindingRevision,
	});
	zip.file('manifest.json', JSON.stringify(manifest));
	frames.forEach((frame, index) => zip.file(manifest.shots[index].frameFile, frame.png));
	const body = await zip.generateAsync({
		type: 'blob',
		compression: 'DEFLATE',
		compressionOptions: { level: 4 },
	});
	const response = await fetch(input.endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/zip' },
		body,
	});
	if (!response.ok) {
		throw new Error(`创建视频任务失败：HTTP ${response.status}`);
	}
	return response.json() as Promise<StoryboardJobProgress>;
}

export async function readStoryboardRenderJob(
	endpoint: string,
	jobId: string,
	jobToken: string,
): Promise<StoryboardJobProgress> {
	const response = await fetch(`${endpoint}/${encodeURIComponent(jobId)}`, {
		headers: { 'X-Storyboard-Job-Token': jobToken },
	});
	if (!response.ok) {
		throw new Error(`读取任务失败：HTTP ${response.status}`);
	}
	return response.json() as Promise<StoryboardJobProgress>;
}

export async function cancelStoryboardRenderJob(
	endpoint: string,
	jobId: string,
	jobToken: string,
): Promise<void> {
	const response = await fetch(`${endpoint}/${encodeURIComponent(jobId)}/cancel`, {
		method: 'POST',
		headers: { 'X-Storyboard-Job-Token': jobToken },
	});
	if (!response.ok) {
		throw new Error(`取消任务失败：HTTP ${response.status}`);
	}
}
