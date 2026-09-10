import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { runCommand } from './ffmpeg-runner';

export interface VideoOutputReceipt {
	sha256: string;
	bytes: number;
	durationMs: number;
}

export async function verifyVideoOutput(
	path: string,
	expectedDurationMs: number,
	fps: number,
	signal: AbortSignal,
): Promise<VideoOutputReceipt> {
	const { stdout } = await runCommand(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path],
		{ signal, timeoutMs: 15_000 },
	);
	const probe = JSON.parse(stdout) as {
		streams?: Array<{ codec_type?: string }>;
		format?: { duration?: string };
	};
	const streamTypes = new Set(probe.streams?.map((stream) => stream.codec_type));
	const durationMs = Number(probe.format?.duration) * 1000;
	const toleranceMs = 1000 / fps + 5;
	if (
		!streamTypes.has('video') ||
		!streamTypes.has('audio') ||
		!Number.isFinite(durationMs) ||
		Math.abs(durationMs - expectedDurationMs) > toleranceMs
	) {
		throw new Error('OUTPUT_VERIFICATION_FAILED');
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk as Buffer);
	}
	return {
		sha256: hash.digest('hex'),
		bytes: (await stat(path)).size,
		durationMs,
	};
}
