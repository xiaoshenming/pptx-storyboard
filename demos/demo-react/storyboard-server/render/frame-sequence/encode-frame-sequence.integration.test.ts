import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCommand } from '../ffmpeg-runner';
import { encodeFrameSequence } from './index';

const workDirs: string[] = [];

afterEach(async () => {
	await Promise.all(workDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('frame sequence ffmpeg integration', () => {
	it('encodes exact ordered frame count as an H.264 yuv420p segment', async () => {
		const workDir = await mkdtemp(join(tmpdir(), 'frame-sequence-integration-'));
		workDirs.push(workDir);
		const red = join(workDir, 'red.png');
		const redCopy = join(workDir, 'red-copy.png');
		const blue = join(workDir, 'blue.png');
		await runCommand('ffmpeg', [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'color=c=red:s=320x180',
			'-frames:v',
			'1',
			red,
		]);
		await copyFile(red, redCopy);
		await runCommand('ffmpeg', [
			'-y',
			'-f',
			'lavfi',
			'-i',
			'color=c=blue:s=320x180',
			'-frames:v',
			'1',
			blue,
		]);
		const outputPath = join(workDir, 'segment.mp4');

		const result = await encodeFrameSequence({
			framePaths: [red, redCopy, blue, blue],
			fps: 30,
			outputPath,
			encoder: 'libx264',
		});

		expect(result).toMatchObject({ frameCount: 4, holdRunCount: 2, staticHoldFrames: 2 });
		expect((await stat(outputPath)).size).toBeGreaterThan(0);
		const { stdout } = await runCommand('ffprobe', [
			'-v',
			'error',
			'-count_frames',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=codec_name,pix_fmt,nb_read_frames,duration,avg_frame_rate',
			'-of',
			'json',
			outputPath,
		]);
		const stream = (
			JSON.parse(stdout) as {
				streams: Array<{
					codec_name: string;
					pix_fmt: string;
					nb_read_frames: string;
					duration: string;
					avg_frame_rate: string;
				}>;
			}
		).streams[0];
		expect(stream).toMatchObject({
			codec_name: 'h264',
			pix_fmt: 'yuv420p',
			nb_read_frames: '4',
			avg_frame_rate: '30/1',
		});
		expect(Number(stream.duration)).toBeCloseTo(4 / 30, 2);
	}, 30_000);
});
