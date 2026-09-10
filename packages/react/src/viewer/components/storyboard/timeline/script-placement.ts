import { sortClips } from './model';
import type { TimelineClip, TimelineScriptFragment, TimelineTrack } from './types';

export interface ScriptPlacementInput extends TimelineScriptFragment {
	startMs?: number;
	durationMs?: number;
	anchorClipId?: string;
}

export interface ScriptPlacementOptions {
	startMs?: number;
	gapMs?: number;
	minimumDurationMs?: number;
	charactersPerSecond?: number;
	anchorClips?: TimelineClip[];
}

export function estimateScriptDuration(
	text: string,
	charactersPerSecond = 4.5,
	minimumDurationMs = 800,
): number {
	const count = [...text.replace(/\s/g, '')].length;
	return Math.max(
		minimumDurationMs,
		Math.ceil((count / Math.max(0.1, charactersPerSecond)) * 1000),
	);
}

export function placeScriptFragments(
	track: TimelineTrack,
	fragments: ScriptPlacementInput[],
	options: ScriptPlacementOptions = {},
): TimelineTrack {
	if (track.kind !== 'narration' && track.kind !== 'subtitle') {
		return track;
	}
	const scriptKind = track.kind;
	const anchors = new Map((options.anchorClips ?? []).map((clip) => [clip.id, clip]));
	const gapMs = Math.max(0, options.gapMs ?? 0);
	let cursor = Math.max(0, options.startMs ?? 0);
	const fragmentIds = new Set(fragments.map(({ id }) => id));
	const clips = fragments.map((fragment): TimelineClip => {
		const anchor = fragment.anchorClipId ? anchors.get(fragment.anchorClipId) : undefined;
		const startMs = Math.max(0, fragment.startMs ?? anchor?.startMs ?? cursor);
		const durationMs = Math.max(
			1,
			fragment.durationMs ??
				anchor?.durationMs ??
				estimateScriptDuration(
					fragment.text,
					options.charactersPerSecond,
					options.minimumDurationMs,
				),
		);
		cursor = Math.max(cursor, startMs + durationMs + gapMs);
		return {
			id: fragment.id,
			trackId: track.id,
			kind: scriptKind,
			startMs,
			durationMs,
			label: fragment.text,
			sourceId: fragment.sourceId,
			script: {
				id: fragment.id,
				text: fragment.text,
				role: fragment.role ?? scriptKind,
				sourceId: fragment.sourceId,
			},
		};
	});
	return {
		...track,
		clips: sortClips([...track.clips.filter(({ id }) => !fragmentIds.has(id)), ...clips]),
	};
}
