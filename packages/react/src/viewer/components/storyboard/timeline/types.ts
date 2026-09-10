import type { TimelineBinding } from './binding';

export type TimelineTrackKind = 'visual' | 'animation' | 'narration' | 'subtitle';

export type TimelineCollisionStrategy = 'allow' | 'reject' | 'overwrite' | 'ripple';

export interface TimelineScriptFragment {
	id: string;
	text: string;
	role?: 'narration' | 'subtitle';
	sourceId?: string;
}

export interface TimelineClip {
	id: string;
	trackId: string;
	kind: TimelineTrackKind;
	startMs: number;
	durationMs: number;
	label?: string;
	sourceId?: string;
	parallelGroupId?: string;
	script?: TimelineScriptFragment;
	binding?: TimelineBinding;
	metadata?: Readonly<Record<string, unknown>>;
}

export interface TimelineTrack {
	id: string;
	kind: TimelineTrackKind;
	name: string;
	clips: TimelineClip[];
	locked?: boolean;
	muted?: boolean;
	collisionStrategy?: TimelineCollisionStrategy;
}

export interface TimelineModel {
	tracks: TimelineTrack[];
	frameRate: number;
	durationMs: number;
}

export interface TimelineSnapPoint {
	timeMs: number;
	type: 'origin' | 'grid' | 'clip-start' | 'clip-end' | 'playhead' | 'marker';
	sourceId?: string;
}

export interface TimelineSnapOptions {
	enabled?: boolean;
	thresholdPx?: number;
	pixelsPerSecond: number;
	gridMs?: number;
	points?: TimelineSnapPoint[];
}

export interface TimelineSnapResult {
	timeMs: number;
	deltaMs: number;
	point?: TimelineSnapPoint;
}

export interface TimelineEditResult {
	timeline: TimelineModel;
	accepted: boolean;
	clipIds: string[];
	collisionIds: string[];
	snap?: TimelineSnapResult;
}

export interface StoryboardTimelineSegment {
	id: string;
	durationMs: number;
	label?: string;
	script?: string;
	animationId?: string;
	parallelGroupId?: string;
}
