export type FrameSequenceEncoder = 'h264_nvenc' | 'libx264';

export interface EncodeFrameSequenceOptions {
	framePaths: readonly string[];
	fps: number;
	outputPath: string;
	encoder: FrameSequenceEncoder;
	signal?: AbortSignal;
	optimizeStaticHolds?: boolean;
}

export interface FrameSequenceEncodeResult {
	outputPath: string;
	encoder: FrameSequenceEncoder;
	frameCount: number;
	holdRunCount: number;
	staticHoldFrames: number;
	durationMs: number;
}
