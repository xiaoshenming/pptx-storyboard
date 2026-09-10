import JSZip from 'jszip';
import type { PptxElement, PptxSlide } from 'pptx-viewer-core';

import type { CanvasSize } from '../../types';
import { captureStoryboardShotsAsPng } from './capture';
import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';
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
	const visualBySource = new Map(
		(input.timeline.tracks.find((track) => track.kind === 'visual')?.clips ?? []).map((clip) => [
			clip.sourceId,
			clip,
		]),
	);
	const manifest = {
		version: 1 as const,
		fileName: input.fileName,
		width: input.width,
		height: input.height,
		fps: 30,
		voiceType: input.voiceType,
		speed: input.speed,
		shots: input.shots.map((shot, index) => {
			const visual = visualBySource.get(shot.id);
			const value = {
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
				startFrame: millisecondsToFrame(visual?.startMs ?? 0, 30),
				frameCount: Math.max(1, millisecondsToFrame(visual?.durationMs ?? shot.durationMs, 30)),
				script: shot.script,
				subtitlesEnabled: shot.subtitlesEnabled ?? true,
			};
			return value;
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
				})) ?? [],
	};
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
