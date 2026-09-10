import React from 'react';

import { millisecondsToPixels } from './timeline';
import type { TimelineTrack } from './timeline';

/** One drawn bracket over animation clips that play simultaneously. */
export interface AnimationGroupBracket {
	clipIds: string[];
	groupId: string;
	/** `同时播放 N 个动画`, shown only for groups of two or more. */
	label: string;
	leftPx: number;
	widthPx: number;
}

/**
 * Buckets an animation track's clips by parallelGroupId plus a shared startMs;
 * buckets with two or more clips become a bracket spanning min start to max end.
 * Pure, so grouping and geometry are unit-testable without a DOM.
 */
export function animationGroupBrackets(
	track: TimelineTrack,
	pixelsPerSecond: number,
): AnimationGroupBracket[] {
	if (track.kind !== 'animation' || pixelsPerSecond <= 0) {
		return [];
	}
	const buckets = new Map<string, TimelineTrack['clips']>();
	for (const clip of track.clips) {
		if (!clip.parallelGroupId) {
			continue;
		}
		// 同组且同 startMs 才算同时播放；key 里并入 startMs 避免跨拍合并。
		const key = `${clip.parallelGroupId}@${clip.startMs}`;
		const bucket = buckets.get(key);
		buckets.set(key, bucket ? [...bucket, clip] : [clip]);
	}
	return [...buckets.entries()].flatMap(([key, clips]) => {
		if (clips.length < 2) {
			return [];
		}
		const groupId = key.slice(0, key.lastIndexOf('@'));
		const startPx = millisecondsToPixels(
			Math.min(...clips.map((clip) => clip.startMs)),
			pixelsPerSecond,
		);
		const endPx = millisecondsToPixels(
			Math.max(...clips.map((clip) => clip.startMs + clip.durationMs)),
			pixelsPerSecond,
		);
		return [
			{
				clipIds: clips.map((clip) => clip.id),
				groupId,
				label: `同时播放 ${clips.length} 个动画`,
				leftPx: startPx,
				widthPx: Math.max(1, endPx - startPx),
			},
		];
	});
}

/**
 * Stable React key: groupId + lead clip id + leftPx. `groupId:leftPx` alone
 * can collide (two brackets of the same group rendered at the same offset),
 * and a collided key makes React drop the second bracket.
 */
export function animationBracketKey(bracket: AnimationGroupBracket): string {
	return `${bracket.groupId}:${bracket.clipIds[0] ?? ''}:${bracket.leftPx}`;
}

/** Bracket lines + group captions rendered above an animation track row. */
export function AnimationGroupBrackets({
	brackets,
}: {
	brackets: AnimationGroupBracket[];
}): React.ReactElement {
	return (
		<>
			{brackets.map((bracket) => (
				<div
					key={animationBracketKey(bracket)}
					data-group-bracket={bracket.groupId}
					data-group-clip-ids={bracket.clipIds.join(',')}
					className='pointer-events-none absolute top-0 z-20 h-1.5 border-x border-t border-violet-300/80'
					style={{ left: bracket.leftPx, width: bracket.widthPx }}
				>
					<span className='absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-violet-500/90 px-1 text-[9px] leading-3 text-white'>
						{bracket.label}
					</span>
				</div>
			))}
		</>
	);
}
