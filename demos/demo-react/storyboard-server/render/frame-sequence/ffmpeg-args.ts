import type { FrameSequenceEncoder } from './types';

function encoderArgs(encoder: FrameSequenceEncoder): string[] {
	return encoder === 'h264_nvenc'
		? ['-c:v', encoder, '-preset', 'p4', '-cq', '21']
		: ['-c:v', encoder, '-preset', 'veryfast', '-crf', '20'];
}

export function buildFfmpegArgs(options: {
	manifestPath: string;
	fps: number;
	frameCount: number;
	outputPath: string;
	encoder: FrameSequenceEncoder;
}): string[] {
	return [
		'-y',
		'-nostdin',
		'-hide_banner',
		'-loglevel',
		'error',
		'-protocol_whitelist',
		'file,pipe',
		'-f',
		'concat',
		'-safe',
		'0',
		'-i',
		options.manifestPath,
		'-vf',
		`fps=${options.fps},format=yuv420p`,
		'-frames:v',
		String(options.frameCount),
		...encoderArgs(options.encoder),
		'-an',
		'-movflags',
		'+faststart',
		options.outputPath,
	];
}
