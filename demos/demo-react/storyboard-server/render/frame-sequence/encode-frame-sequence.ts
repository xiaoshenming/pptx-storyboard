import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCommand } from '../ffmpeg-runner';
import { buildFfmpegArgs } from './ffmpeg-args';
import { writeConcatInput } from './ffmpeg-input';
import { buildFrameRuns } from './frame-runs';
import type { EncodeFrameSequenceOptions, FrameSequenceEncodeResult } from './types';

function validateOptions(options: EncodeFrameSequenceOptions): void {
	if (options.framePaths.length === 0) {
		throw new Error('FRAME_SEQUENCE_EMPTY');
	}
	if (!Number.isFinite(options.fps) || options.fps <= 0) {
		throw new Error('FRAME_SEQUENCE_INVALID_FPS');
	}
	if (!options.outputPath) {
		throw new Error('FRAME_SEQUENCE_OUTPUT_REQUIRED');
	}
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
}

export async function encodeFrameSequence(
	options: EncodeFrameSequenceOptions,
): Promise<FrameSequenceEncodeResult> {
	validateOptions(options);
	assertNotAborted(options.signal);
	const outputPath = resolve(options.outputPath);
	const workDir = await mkdtemp(join(tmpdir(), 'storyboard-frame-sequence-'));
	try {
		const runs = await buildFrameRuns(
			options.framePaths,
			options.optimizeStaticHolds ?? true,
			options.signal,
		);
		assertNotAborted(options.signal);
		const manifestPath = await writeConcatInput(workDir, runs, options.fps, options.signal);
		await runCommand(
			'ffmpeg',
			buildFfmpegArgs({
				manifestPath,
				fps: options.fps,
				frameCount: options.framePaths.length,
				outputPath,
				encoder: options.encoder,
			}),
			{ signal: options.signal, timeoutMs: 30 * 60 * 1000 },
		);
		return {
			outputPath,
			encoder: options.encoder,
			frameCount: options.framePaths.length,
			holdRunCount: runs.length,
			staticHoldFrames: options.framePaths.length - runs.length,
			durationMs: (options.framePaths.length / options.fps) * 1000,
		};
	} catch (error) {
		await rm(outputPath, { force: true });
		throw error;
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
