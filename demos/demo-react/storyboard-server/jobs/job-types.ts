export type StoryboardJobStage =
	| 'queued'
	| 'preparing'
	| 'synthesizing'
	| 'rendering'
	| 'muxing'
	| 'completed'
	| 'failed'
	| 'cancelled';

export type StoryboardTaskKind = 'tts' | 'render' | 'mux';
export type StoryboardTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface StoryboardRenderTask {
	id: string;
	kind: StoryboardTaskKind;
	shotId?: string;
	status: StoryboardTaskStatus;
	progress: number;
	attempt: number;
	error?: string;
}

export interface StoryboardJob {
	id: string;
	stage: StoryboardJobStage;
	progress: number;
	createdAt: string;
	updatedAt: string;
	workDir: string;
	tasks: StoryboardRenderTask[];
	outputPath?: string;
	subtitlePath?: string;
	error?: string;
	cancelRequested: boolean;
	accessToken: string;
	execution?: {
		encoder: 'h264_nvenc' | 'libx264';
		renderConcurrency: number;
		ttsConcurrency: number;
		elapsedMs: number;
		outputDurationMs: number;
		verifiedDurationMs?: number;
		outputBytes?: number;
		outputSha256?: string;
	};
}

export interface StoryboardJobSnapshot extends Omit<
	StoryboardJob,
	'workDir' | 'outputPath' | 'subtitlePath' | 'accessToken'
> {
	downloadUrl?: string;
	subtitleUrl?: string;
}

export interface StoryboardJobManifest {
	version: 1;
	fileName: string;
	width: number;
	height: number;
	fps: number;
	voiceType: number;
	speed: number;
	shots: Array<{
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
	}>;
	narrationClips: Array<{
		id: string;
		sourceShotId: string;
		startMs: number;
		startSample: number;
		durationMs: number;
		script: string;
	}>;
}
