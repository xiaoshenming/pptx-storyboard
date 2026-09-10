import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCommand } from '../render/ffmpeg-runner';
import { FakeStoryboardSynthesizer } from './fake-synthesizer';
import { cancelRunningStoryboardJob, runStoryboardJob } from './job-runner';
import type { StoryboardJob, StoryboardJobManifest } from './job-types';

const workDirs: string[] = [];

function srtMilliseconds(value: string): number {
	const [hours, minutes, seconds, milliseconds] = value.split(/[:,]/u).map(Number);
	return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

afterEach(async () => {
	delete process.env.STORYBOARD_GPU_ENCODING;
	await Promise.all(workDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('storyboard render job', () => {
	it('cancels an in-flight synthesizer through the task abort signal', async () => {
		const workDir = await mkdtemp(join(tmpdir(), 'storyboard-cancel-test-'));
		workDirs.push(workDir);
		const timestamp = new Date().toISOString();
		const job: StoryboardJob = {
			id: '22222222-2222-4222-8222-222222222222',
			stage: 'queued',
			progress: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
			workDir,
			tasks: [],
			cancelRequested: false,
			accessToken: 'test-token',
		};
		const pending = runStoryboardJob(
			job,
			{
				...manifestFixture(),
				shots: [],
				narrationClips: [
					{
						id: 'narration-cancel',
						sourceShotId: 'shot-cancel',
						startMs: 0,
						startSample: 0,
						durationMs: 1000,
						script: '取消测试',
					},
				],
			},
			{
				synthesize: ({ signal }) =>
					new Promise((_, reject) => {
						signal.addEventListener('abort', () =>
							reject(new DOMException('Cancelled', 'AbortError')),
						);
					}),
			},
		);
		await new Promise<void>((resolve) => {
			queueMicrotask(resolve);
		});
		expect(cancelRunningStoryboardJob(job.id)).toBeTruthy();
		await pending;
		expect(job.stage).toBe('cancelled');
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 20);
		});
	});

	it('renders parallel segments and produces video, audio and subtitle streams', async () => {
		process.env.STORYBOARD_GPU_ENCODING = '0';
		const workDir = await mkdtemp(join(tmpdir(), 'storyboard-job-test-'));
		workDirs.push(workDir);
		await runCommand('ffmpeg', [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'color=c=blue:s=320x180',
			'-frames:v',
			'1',
			join(workDir, 'frame-0.png'),
		]);
		await runCommand('ffmpeg', [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'color=c=red:s=320x180',
			'-frames:v',
			'1',
			join(workDir, 'frame-1.png'),
		]);
		const timestamp = new Date().toISOString();
		const job: StoryboardJob = {
			id: '11111111-1111-4111-8111-111111111111',
			stage: 'queued',
			progress: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
			workDir,
			tasks: [],
			cancelRequested: false,
			accessToken: 'test-token',
		};
		const manifest: StoryboardJobManifest = {
			version: 1,
			fileName: 'test.pptx',
			width: 320,
			height: 180,
			fps: 30,
			voiceType: 101001,
			speed: 0,
			shots: [
				{
					id: 'shot-1',
					frameFile: 'frame-0.png',
					startMs: 0,
					durationMs: 500,
					startFrame: 0,
					frameCount: 15,
					script: '第一镜',
					subtitlesEnabled: true,
				},
				{
					id: 'shot-2',
					frameFile: 'frame-1.png',
					previousFrameFile: 'frame-0.png',
					transitionMs: 200,
					startMs: 500,
					durationMs: 500,
					startFrame: 15,
					frameCount: 15,
					script: '第二镜',
					subtitlesEnabled: true,
				},
			],
			narrationClips: [
				{
					id: 'narration-1',
					sourceShotId: 'shot-1',
					startMs: 0,
					startSample: 0,
					durationMs: 500,
					script: '第一镜',
				},
				{
					id: 'narration-2',
					sourceShotId: 'shot-2',
					startMs: 500,
					startSample: 24000,
					durationMs: 500,
					script: '第二镜',
				},
			],
		};
		await runStoryboardJob(job, manifest, new FakeStoryboardSynthesizer());
		expect(job.stage).toBe('completed');
		expect(job.outputPath).toBeTruthy();
		expect(job.tasks.every((task) => task.status === 'succeeded')).toBeTruthy();
		const { stdout } = await runCommand(
			'ffprobe',
			[
				'-v',
				'error',
				'-show_entries',
				'stream=codec_type,codec_name',
				'-of',
				'json',
				job.outputPath!,
			],
			{ timeoutMs: 10_000 },
		);
		const streams = (JSON.parse(stdout) as { streams: Array<{ codec_type: string }> }).streams;
		expect(streams.map((stream) => stream.codec_type)).toStrictEqual(
			expect.arrayContaining(['video', 'audio']),
		);
		await expect(stat(join(workDir, 'storyboard.srt'))).resolves.toBeTruthy();
		const subtitle = await readFile(join(workDir, 'storyboard.srt'), 'utf8');
		for (const match of subtitle.matchAll(/(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})/gu)) {
			expect(srtMilliseconds(match[1])).toBeLessThan(srtMilliseconds(match[2]));
		}
	}, 30_000);
});

function manifestFixture(): StoryboardJobManifest {
	return {
		version: 1,
		fileName: 'test.pptx',
		width: 320,
		height: 180,
		fps: 30,
		voiceType: 101001,
		speed: 0,
		shots: [],
		narrationClips: [],
	};
}
