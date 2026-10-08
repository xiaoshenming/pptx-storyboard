import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import { setStoryboardJobStage, updateStoryboardJob } from '../jobs/job-store';
import type { StoryboardJob, StoryboardJobManifest, StoryboardRenderTask } from '../jobs/job-types';
import { mapConcurrent } from './concurrency';
import { detectVideoEncoder, runCommand } from './ffmpeg-runner';
import { narrationToSrt } from './subtitles';
import type { StoryboardNarrationCue, StoryboardWordBoundary } from './subtitles';
import { compileRenderTiming } from './timing';

export interface SynthesizedShotAudio {
	clipId: string;
	sourceShotId: string;
	startMs: number;
	startSample: number;
	audioPath?: string;
	durationMs: number;
	words: StoryboardWordBoundary[];
}

function renderConcurrency(encoder: 'h264_nvenc' | 'libx264'): number {
	const configured = Number(process.env.STORYBOARD_RENDER_CONCURRENCY || '0');
	const ceiling = encoder === 'h264_nvenc' ? 8 : 4;
	if (Number.isFinite(configured) && configured > 0) {
		return Math.min(ceiling, Math.floor(configured));
	}
	return Math.max(2, Math.min(ceiling, Math.floor(cpus().length / 3)));
}

function encoderArgs(encoder: 'h264_nvenc' | 'libx264'): string[] {
	return encoder === 'h264_nvenc'
		? ['-c:v', encoder, '-preset', 'p4', '-cq', '21']
		: ['-c:v', encoder, '-preset', 'veryfast', '-crf', '20'];
}

function task(job: StoryboardJob, shotId: string): StoryboardRenderTask {
	const value: StoryboardRenderTask = {
		id: `${job.id}:render:${shotId}`,
		kind: 'render',
		shotId,
		status: 'queued',
		progress: 0,
		attempt: 0,
	};
	job.tasks.push(value);
	return value;
}

function insideWorkDir(job: StoryboardJob, path: string): string {
	const root = `${resolve(job.workDir)}${sep}`;
	const target = resolve(path);
	if (!`${target}${sep}`.startsWith(root) && !target.startsWith(root)) {
		throw new Error('UNSAFE_MEDIA_PATH');
	}
	return target;
}

function ffmpegFilterPath(path: string): string {
	return path.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

export async function renderStoryboardVideo(
	job: StoryboardJob,
	manifest: StoryboardJobManifest,
	audio: SynthesizedShotAudio[],
	signal: AbortSignal,
): Promise<{
	videoPath: string;
	subtitlePath?: string;
	encoder: 'h264_nvenc' | 'libx264';
	renderConcurrency: number;
	outputDurationMs: number;
}> {
	const encoder = await detectVideoEncoder(manifest.width, manifest.height);
	const concurrency = renderConcurrency(encoder);
	const timing = compileRenderTiming(manifest, audio);
	const frameCounts = timing.shotFrameCounts;
	const durations = timing.shotDurationsMs;
	const totalDurationMs = timing.totalDurationMs;
	const narrations: StoryboardNarrationCue[] = [];
	for (const shot of manifest.shots) {
		if (!shot.subtitlesEnabled) {
			continue;
		}
		const shotAudio = audio.filter((item) => item.sourceShotId === shot.id);
		for (const clip of shotAudio) {
			const placement = timing.audio.get(clip.clipId);
			if (!placement) {
				continue;
			}
			const text = manifest.narrationClips.find((item) => item.id === clip.clipId)?.script.trim();
			if (text) {
				narrations.push({
					text,
					startMs: placement.startMs,
					endMs: placement.startMs + clip.durationMs,
				});
			}
		}
	}
	const subtitlePath = narrations.length ? join(job.workDir, 'storyboard.srt') : undefined;
	if (subtitlePath) {
		await writeFile(subtitlePath, narrationToSrt(narrations));
	}

	const renderTasks = manifest.shots.map((shot) => task(job, shot.id));
	const muxTask: StoryboardRenderTask = {
		id: `${job.id}:mux:final`,
		kind: 'mux',
		status: 'queued',
		progress: 0,
		attempt: 0,
	};
	job.tasks.push(muxTask);
	let rendered = 0;
	const segmentPaths = await mapConcurrent(manifest.shots, concurrency, async (shot, index) => {
		const renderTask = renderTasks[index];
		renderTask.status = 'running';
		renderTask.attempt += 1;
		const framePath = insideWorkDir(job, join(job.workDir, shot.frameFile));
		const previousFramePath = shot.previousFrameFile
			? insideWorkDir(job, join(job.workDir, shot.previousFrameFile))
			: undefined;
		const outputPath = join(job.workDir, `segment-${String(index).padStart(5, '0')}.mp4`);
		const args = [
			'-y',
			'-nostdin',
			'-protocol_whitelist',
			'file,pipe',
			'-framerate',
			String(manifest.fps),
			'-i',
			framePath,
		];
		if (previousFramePath) {
			args.push('-framerate', String(manifest.fps), '-i', previousFramePath);
		}
		const scale = `scale=${manifest.width}:${manifest.height}:force_original_aspect_ratio=decrease,pad=${manifest.width}:${manifest.height}:(ow-iw)/2:(oh-ih)/2`;
		args.push('-filter_threads', '2', '-filter_complex_threads', '2');
		args.push('-frames:v', String(frameCounts[index]), ...encoderArgs(encoder));
		const still = `${scale},setsar=1,loop=loop=-1:size=1:start=0,setpts=N/(${manifest.fps}*TB),fps=${manifest.fps}`;
		const captions = subtitlePath
			? `,setpts=PTS+${(timing.shotStartsMs[index] / 1000).toFixed(6)}/TB,subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='FontName=Microsoft YaHei,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=34,Alignment=2',setpts=PTS-STARTPTS`
			: '';
		if (previousFramePath) {
			const transitionSec =
				Math.min(shot.transitionMs ?? 400, Math.max(100, durations[index] - 100)) / 1000;
			args.push(
				'-filter_complex',
				`[1:v]${still}[before];[0:v]${still}[after];[before][after]xfade=transition=fade:duration=${transitionSec.toFixed(3)}:offset=0,format=yuv420p${captions}[v]`,
				'-map',
				'[v]',
			);
		} else {
			args.push('-vf', `${still},format=yuv420p${captions}`);
		}
		args.push('-r', String(manifest.fps), '-pix_fmt', 'yuv420p', '-an', '-threads', '2');
		args.push(outputPath);
		try {
			await runCommand('ffmpeg', args, { signal });
			renderTask.status = 'succeeded';
			renderTask.progress = 100;
			rendered += 1;
			updateStoryboardJob(job, {
				progress: 48 + Math.round((rendered / manifest.shots.length) * 40),
			});
			return outputPath;
		} catch (error) {
			renderTask.status = signal.aborted ? 'cancelled' : 'failed';
			renderTask.error = 'SEGMENT_RENDER_FAILED';
			throw error;
		}
	});
	setStoryboardJobStage(job, 'muxing');
	updateStoryboardJob(job, { progress: 90 });
	muxTask.status = 'running';
	muxTask.attempt += 1;

	const concatPath = join(job.workDir, 'segments.txt');
	await writeFile(concatPath, segmentPaths.map((path) => `file '${basename(path)}'`).join('\n'));

	const outputPath = join(job.workDir, 'storyboard.mp4');
	const audioInputs = audio.filter((item) => item.audioPath);
	const finalArgs = [
		'-y',
		'-nostdin',
		'-protocol_whitelist',
		'file,pipe',
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		concatPath,
	];
	for (const item of audioInputs) {
		finalArgs.push('-i', insideWorkDir(job, item.audioPath!));
	}
	if (audioInputs.length > 0) {
		const chains = audioInputs.map((item, index) => {
			const startSample = timing.audio.get(item.clipId)?.startSample ?? item.startSample;
			return `[${index + 1}:a]aresample=48000,asetpts=PTS-STARTPTS,adelay=${startSample}S:all=1[a${index}]`;
		});
		chains.push(
			`${audioInputs.map((_, index) => `[a${index}]`).join('')}amix=inputs=${audioInputs.length}:duration=longest:normalize=0,atrim=duration=${(totalDurationMs / 1000).toFixed(3)},asetpts=N/SR/TB[aout]`,
		);
		finalArgs.push('-filter_complex', chains.join(';'), '-map', '0:v', '-map', '[aout]');
	} else {
		finalArgs.push('-map', '0:v');
	}
	// Captions were burned during segment encoding; final mux copies the video stream.
	finalArgs.push('-c:v', 'copy');
	if (audioInputs.length > 0) {
		finalArgs.push('-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k');
	}
	finalArgs.push('-t', (totalDurationMs / 1000).toFixed(3), '-movflags', '+faststart', outputPath);
	await runCommand('ffmpeg', finalArgs, { signal, cwd: job.workDir });
	muxTask.status = 'succeeded';
	muxTask.progress = 100;
	return {
		videoPath: outputPath,
		subtitlePath,
		encoder,
		renderConcurrency: concurrency,
		outputDurationMs: totalDurationMs,
	};
}
