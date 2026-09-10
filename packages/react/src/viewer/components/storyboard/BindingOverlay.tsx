import React, { useState } from 'react';

import { cn } from '../../utils';
import { clipMetadataString } from './narration-binding-actions';
import { clampPlayhead, millisecondsToPixels, pixelsToMilliseconds } from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

/** Ruler strip height in px (h-6). */
export const TIMELINE_RULER_HEIGHT_PX = 24;
/** One track row height in px (h-12). */
export const TIMELINE_TRACK_ROW_HEIGHT_PX = 48;

const ANCHOR_SIZE_PX = 8;
const ANCHOR_SELECTED_SIZE_PX = 10;
const ANCHOR_MAGNET_SIZE_PX = 12;

function anchorTitle(clip: TimelineClip): string {
	const meta = (key: string) => clipMetadataString(clip.metadata, key);
	return [meta('anchorLabel'), meta('effectLabel'), meta('targetLabel')]
		.filter(Boolean)
		.join(' · ');
}

function anchorGeometry(timeline: TimelineModel, pixelsPerSecond: number) {
	const anchors: { clip: TimelineClip; x: number; y: number }[] = [];
	const narrationMidpoints = new Map<string, { x: number; y: number }>();
	timeline.tracks.forEach((track, index) => {
		const centerY =
			TIMELINE_RULER_HEIGHT_PX +
			index * TIMELINE_TRACK_ROW_HEIGHT_PX +
			TIMELINE_TRACK_ROW_HEIGHT_PX / 2;
		for (const clip of track.clips) {
			const x = millisecondsToPixels(clip.startMs, pixelsPerSecond);
			if (track.kind === 'animation') {
				anchors.push({ clip, x, y: centerY });
			} else if (track.kind === 'narration') {
				narrationMidpoints.set(clip.id, { x, y: centerY });
			}
		}
	});
	return { anchors, narrationMidpoints };
}

/** Second ticks strip; click or drag to move the playhead. Seeks need onSeek. */
export function TimelineRuler({
	timeline,
	pixelsPerSecond,
	onSeek,
}: {
	timeline: TimelineModel;
	pixelsPerSecond: number;
	onSeek?: (timeMs: number) => void;
}): React.ReactElement {
	const [seeking, setSeeking] = useState(false);
	const ticks = Array.from({ length: Math.ceil(timeline.durationMs / 1000) + 2 }, (_, i) => i);
	const seekToClientX = (clientX: number, element: HTMLDivElement) => {
		const rect = element.getBoundingClientRect();
		const ms = pixelsToMilliseconds(clientX - rect.left, pixelsPerSecond);
		onSeek?.(clampPlayhead(timeline, ms));
	};
	return (
		<div
			className={cn(
				'relative h-6 border-b border-white/10 text-[9px] text-slate-500',
				onSeek && 'cursor-pointer',
			)}
			data-testid='timeline-ruler'
			onPointerDown={(event) => {
				if (!onSeek) {
					return;
				}
				event.currentTarget.setPointerCapture(event.pointerId);
				setSeeking(true);
				seekToClientX(event.clientX, event.currentTarget);
			}}
			onPointerMove={(event) => {
				if (seeking) {
					seekToClientX(event.clientX, event.currentTarget);
				}
			}}
			onPointerUp={() => setSeeking(false)}
			onPointerCancel={() => setSeeking(false)}
		>
			{ticks.map((tick) => (
				<span
					key={tick}
					className='absolute top-1 border-l border-white/10 pl-1'
					style={{ left: tick * pixelsPerSecond }}
				>
					{tick}s
				</span>
			))}
		</div>
	);
}

/** Vertical orange playhead spanning ruler plus all track rows. */
export function PlayheadLine({
	timeline,
	playheadMs,
	pixelsPerSecond,
}: {
	timeline: TimelineModel;
	playheadMs: number;
	pixelsPerSecond: number;
}): React.ReactElement {
	const left = millisecondsToPixels(clampPlayhead(timeline, playheadMs), pixelsPerSecond);
	return (
		<div
			className='pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 bg-orange-400'
			style={{ left: left - 1 }}
			data-testid='playhead-line'
		>
			<span className='absolute -left-[3px] top-0 border-x-4 border-t-[6px] border-x-transparent border-t-orange-400' />
		</div>
	);
}

export interface BindingOverlayProps {
	timeline: TimelineModel;
	pixelsPerSecond: number;
	canvasWidth: number;
	/** Emphasizes the anchor of the selected animation clip; links narration lines. */
	selectedClipId?: string;
	hoveredClipId?: string;
	/** Anchor magnified while a dragged narration clip is inside magnet range. */
	magnetAnchorId?: string | null;
}

/**
 * SVG chrome above the track rows: one diamond anchor per animation clip start,
 * plus connector lines only for the selected or hovered narration clip (never
 * all bindings at once, which would flood the canvas with lines).
 */
export function BindingOverlay({
	timeline,
	pixelsPerSecond,
	canvasWidth,
	selectedClipId,
	hoveredClipId,
	magnetAnchorId,
}: BindingOverlayProps): React.ReactElement {
	const { anchors, narrationMidpoints } = anchorGeometry(timeline, pixelsPerSecond);
	const height = TIMELINE_RULER_HEIGHT_PX + timeline.tracks.length * TIMELINE_TRACK_ROW_HEIGHT_PX;
	const narrationClips = timeline.tracks.flatMap((track) =>
		track.kind === 'narration' ? track.clips : [],
	);
	const boundAnchorIds = new Set(
		narrationClips.flatMap((clip) => (clip.binding ? [clip.binding.anchorId] : [])),
	);
	const anchorById = new Map(anchors.map((anchor) => [anchor.clip.id, anchor]));
	const lines = narrationClips.flatMap((clip) => {
		const anchor = clip.binding ? anchorById.get(clip.binding.anchorId) : undefined;
		const from = narrationMidpoints.get(clip.id);
		const active = clip.id === selectedClipId || clip.id === hoveredClipId;
		if (!clip.binding || !anchor || !from || !active) {
			return [];
		}
		const bend = 32;
		return [
			{
				clipId: clip.id,
				path: `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${anchor.x - bend} ${anchor.y}, ${anchor.x} ${anchor.y}`,
			},
		];
	});
	return (
		<svg
			className='pointer-events-none absolute inset-0'
			width={canvasWidth}
			height={height}
			data-testid='binding-overlay'
		>
			{lines.map((line) => (
				<path
					key={line.clipId}
					d={line.path}
					fill='none'
					stroke='rgb(110 231 183)'
					strokeWidth={1.5}
					data-binding-line={line.clipId}
				/>
			))}
			{anchors.map(({ clip, x, y }) => {
				const magnetized = clip.id === magnetAnchorId;
				const selected = clip.id === selectedClipId;
				const size = magnetized
					? ANCHOR_MAGNET_SIZE_PX
					: selected
						? ANCHOR_SELECTED_SIZE_PX
						: ANCHOR_SIZE_PX;
				const outline = magnetized || selected;
				const fill = magnetized
					? 'rgb(251 146 60)'
					: boundAnchorIds.has(clip.id)
						? 'rgb(52 211 153)'
						: 'rgb(167 139 250)';
				return (
					<rect
						key={clip.id}
						x={x - size / 2}
						y={y - size / 2}
						width={size}
						height={size}
						transform={`rotate(45 ${x} ${y})`}
						fill={fill}
						stroke={outline ? 'white' : 'rgba(15, 23, 42, 0.6)'}
						strokeWidth={magnetized ? 1.5 : outline ? 1.2 : 0.5}
						data-anchor-id={clip.id}
						className={cn('pointer-events-auto cursor-help', outline && 'drop-shadow')}
					>
						<title>{anchorTitle(clip)}</title>
					</rect>
				);
			})}
		</svg>
	);
}
