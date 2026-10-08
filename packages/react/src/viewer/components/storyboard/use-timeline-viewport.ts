import { useEffect } from 'react';
import type { RefObject } from 'react';

import { millisecondsToPixels } from './timeline';
import type { TimelineModel } from './timeline';

export function useTimelineViewport(
	scrollViewportRef: RefObject<HTMLDivElement | null>,
	timeline: TimelineModel,
	selectedSourceId: string | undefined,
	pixelsPerSecond: number,
) {
	const selectedClipStartMs = timeline.tracks
		.find((track) => track.kind === 'visual')
		?.clips.find((clip) => clip.sourceId === selectedSourceId)?.startMs;

	useEffect(() => {
		const viewport = scrollViewportRef.current;
		if (!viewport || selectedClipStartMs === undefined || !Number.isFinite(selectedClipStartMs)) {
			return;
		}
		const left = millisecondsToPixels(selectedClipStartMs, pixelsPerSecond);
		if (left < viewport.scrollLeft || left >= viewport.scrollLeft + viewport.clientWidth) {
			viewport.scrollLeft = Math.max(0, left - 24);
		}
	}, [selectedClipStartMs, pixelsPerSecond, scrollViewportRef]);

	useEffect(() => {
		const viewport = scrollViewportRef.current;
		if (!viewport) {
			return;
		}
		const scrollHorizontally = (event: WheelEvent) => {
			const hasHorizontalOverflow = viewport.scrollWidth > viewport.clientWidth;
			const isVerticalWheelGesture = Math.abs(event.deltaY) > Math.abs(event.deltaX);
			if (!hasHorizontalOverflow || !isVerticalWheelGesture || event.ctrlKey || event.metaKey) {
				return;
			}
			event.preventDefault();
			viewport.scrollLeft += event.deltaY;
		};
		viewport.addEventListener('wheel', scrollHorizontally, { passive: false });
		return () => viewport.removeEventListener('wheel', scrollHorizontally);
	}, [scrollViewportRef]);
}
