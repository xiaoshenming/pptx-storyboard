import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';

import type { StoryboardShot } from './storyboard-model';
import type { TimelineModel } from './timeline';

export function useStoryboardPlayback(
	isPlaying: boolean,
	selectedShotId: string,
	shots: StoryboardShot[],
	timeline: TimelineModel,
	setSelectedShotId: Dispatch<SetStateAction<string>>,
	setIsPlaying: Dispatch<SetStateAction<boolean>>,
): void {
	useEffect(() => {
		if (!isPlaying || !selectedShotId) {
			return;
		}
		const index = shots.findIndex((shot) => shot.id === selectedShotId);
		if (index < 0) {
			return;
		}
		const visualDuration = timeline.tracks
			.find((track) => track.kind === 'visual')
			?.clips.find((clip) => clip.sourceId === selectedShotId)?.durationMs;
		const timer = window.setTimeout(() => {
			if (index >= shots.length - 1) {
				setIsPlaying(false);
				return;
			}
			setSelectedShotId(shots[index + 1].id);
		}, visualDuration ?? shots[index].durationMs);
		return () => window.clearTimeout(timer);
	}, [isPlaying, selectedShotId, setIsPlaying, setSelectedShotId, shots, timeline]);
}
