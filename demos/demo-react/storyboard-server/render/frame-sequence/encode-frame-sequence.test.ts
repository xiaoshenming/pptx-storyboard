import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeFrameSequence } from './index';

const runCommand = vi.hoisted(() => vi.fn());
vi.mock(import('../ffmpeg-runner'), () => ({ runCommand }));

const workDirs: string[] = [];

async function fixtureDir(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), 'frame-sequence-unit-'));
	workDirs.push(path);
	return path;
}

afterEach(async () => {
	runCommand.mockReset();
	await Promise.all(workDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('encodeFrameSequence', () => {
	it('collapses consecutive identical PNG contents into timed hold runs', async () => {
		const workDir = await fixtureDir();
		const first = join(workDir, 'first.png');
		const duplicate = join(workDir, 'duplicate.png');
		const final = join(workDir, 'final.png');
		await Promise.all([
			writeFile(first, 'same-png-content'),
			writeFile(duplicate, 'same-png-content'),
			writeFile(final, 'different-png-content'),
		]);
		let manifest = '';
		runCommand.mockImplementation(async (_command: string, args: string[]) => {
			manifest = await readFile(args[args.indexOf('-i') + 1], 'utf8');
			return { stdout: '', stderr: '' };
		});

		const result = await encodeFrameSequence({
			framePaths: [first, duplicate, final],
			fps: 10,
			outputPath: join(workDir, 'segment.mp4'),
			encoder: 'libx264',
		});

		expect(result).toMatchObject({ frameCount: 3, holdRunCount: 2, staticHoldFrames: 1 });
		expect(manifest.match(/^duration /gmu)).toHaveLength(2);
		expect(manifest).toContain('duration 0.200000000');
		expect(manifest).toContain('duration 0.100000000');
		const args = runCommand.mock.calls[0][1] as string[];
		expect(args).toStrictEqual(expect.arrayContaining(['-frames:v', '3', '-c:v', 'libx264']));
	});

	it('supports NVENC and disabling static hold optimization', async () => {
		const workDir = await fixtureDir();
		const frame = join(workDir, 'frame.png');
		await writeFile(frame, 'png-content');
		runCommand.mockResolvedValue({ stdout: '', stderr: '' });

		const result = await encodeFrameSequence({
			framePaths: [frame, frame],
			fps: 25,
			outputPath: join(workDir, 'segment.mp4'),
			encoder: 'h264_nvenc',
			optimizeStaticHolds: false,
		});

		expect(result).toMatchObject({ holdRunCount: 2, staticHoldFrames: 0, durationMs: 80 });
		const args = runCommand.mock.calls[0][1] as string[];
		expect(args).toStrictEqual(expect.arrayContaining(['-c:v', 'h264_nvenc', '-preset', 'p4']));
	});

	it('rejects invalid input and an already aborted operation', async () => {
		await expect(
			encodeFrameSequence({
				framePaths: [],
				fps: 30,
				outputPath: 'unused.mp4',
				encoder: 'libx264',
			}),
		).rejects.toThrow('FRAME_SEQUENCE_EMPTY');
		const controller = new AbortController();
		controller.abort();
		await expect(
			encodeFrameSequence({
				framePaths: ['unused.png'],
				fps: 30,
				outputPath: 'unused.mp4',
				encoder: 'libx264',
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(runCommand).not.toHaveBeenCalled();
	});
});
