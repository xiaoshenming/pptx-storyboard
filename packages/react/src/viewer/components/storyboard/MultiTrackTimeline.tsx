import React, { useMemo, useRef, useState } from 'react';
import { LuAudioLines, LuCaptions, LuFilm, LuLockKeyhole, LuSparkles } from 'react-icons/lu';

import { cn } from '../../utils';
import { moveTimelineClip, resizeTimelineClip, millisecondsToPixels } from './timeline';
import type { TimelineClip, TimelineModel, TimelineTrackKind } from './timeline';

const TRACK_META: Record<TimelineTrackKind, { color: string; icon: React.ReactNode }> = {
	visual: { color: 'bg-sky-500/90', icon: <LuFilm /> },
	animation: { color: 'bg-violet-500/90', icon: <LuSparkles /> },
	narration: { color: 'bg-emerald-500/90', icon: <LuAudioLines /> },
	subtitle: { color: 'bg-amber-500/90', icon: <LuCaptions /> },
};

interface MultiTrackTimelineProps {
	timeline: TimelineModel;
	selectedSourceId?: string;
	onChange: (timeline: TimelineModel) => void;
	onSelectSource: (sourceId: string) => void;
	onPlayAll: () => void;
}

interface DragState {
	clip: TimelineClip;
	clientX: number;
	mode: 'move' | 'resize-end';
}

export function MultiTrackTimeline({
	timeline,
	selectedSourceId,
	onChange,
	onSelectSource,
	onPlayAll,
}: MultiTrackTimelineProps): React.ReactElement {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [pixelsPerSecond, setPixelsPerSecond] = useState(80);
	const [drag, setDrag] = useState<DragState | null>(null);
	const canvasWidth = Math.max(
		900,
		millisecondsToPixels(timeline.durationMs + 2000, pixelsPerSecond),
	);
	const ticks = useMemo(
		() => Array.from({ length: Math.ceil(timeline.durationMs / 1000) + 2 }, (_, index) => index),
		[timeline.durationMs],
	);

	const applyPointer = (event: React.PointerEvent) => {
		if (!drag) {
			return;
		}
		const deltaMs = ((event.clientX - drag.clientX) / pixelsPerSecond) * 1000;
		const proposed =
			drag.mode === 'move'
				? drag.clip.startMs + deltaMs
				: drag.clip.startMs + drag.clip.durationMs + deltaMs;
		const snap = { enabled: true, thresholdPx: 8, pixelsPerSecond, gridMs: 100 };
		const result =
			drag.mode === 'move'
				? moveTimelineClip(timeline, drag.clip.id, proposed, {
						snap,
						collisionStrategy: drag.clip.kind === 'narration' ? 'allow' : 'ripple',
						moveParallelGroup: true,
					})
				: resizeTimelineClip(timeline, drag.clip.id, 'end', proposed, {
						snap,
						minimumDurationMs: 200,
						collisionStrategy: drag.clip.kind === 'narration' ? 'allow' : 'ripple',
					});
		if (result.accepted) {
			onChange(result.timeline);
			const updated = result.timeline.tracks
				.flatMap((track) => track.clips)
				.find((clip) => clip.id === drag.clip.id);
			if (updated) {
				setDrag({ ...drag, clip: updated, clientX: event.clientX });
			}
		}
	};

	return (
		<section className='h-[270px] shrink-0 border-t border-slate-200 bg-slate-950 text-white'>
			<header className='flex h-11 items-center gap-3 border-b border-white/10 px-4 text-xs'>
				<strong>专业时间轴</strong>
				<span className='text-slate-500'>旁白可拖动，其他轨道自动跟随</span>
				<span className='text-slate-400'>
					{timeline.tracks.reduce((count, track) => count + track.clips.length, 0)} 个片段
				</span>
				<button
					type='button'
					onClick={onPlayAll}
					className='ml-auto rounded-md bg-white/10 px-3 py-1.5 hover:bg-white/20'
				>
					全局播放
				</button>
				<label className='flex items-center gap-2 text-slate-400'>
					缩放
					<input
						type='range'
						min={30}
						max={240}
						value={pixelsPerSecond}
						onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
						className='w-24 accent-orange-500'
					/>
				</label>
			</header>
			<div className='flex h-[226px]'>
				<div className='w-28 shrink-0 border-r border-white/10 pt-6'>
					{timeline.tracks.map((track) => (
						<div
							key={track.id}
							className='flex h-12 items-center gap-2 border-b border-white/5 px-3 text-xs text-slate-300'
						>
							{TRACK_META[track.kind].icon}
							<span>{track.name}</span>
							{track.locked && <LuLockKeyhole className='ml-auto h-3 w-3 text-slate-500' />}
						</div>
					))}
				</div>
				<div
					ref={scrollerRef}
					className='min-w-0 flex-1 overflow-auto'
					onPointerMove={applyPointer}
					onPointerUp={() => setDrag(null)}
					onPointerCancel={() => setDrag(null)}
				>
					<div className='relative' style={{ width: canvasWidth }}>
						<div className='relative h-6 border-b border-white/10 text-[9px] text-slate-500'>
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
						{timeline.tracks.map((track) => (
							<div key={track.id} className='relative h-12 border-b border-white/5 bg-white/[0.02]'>
								{track.clips.map((clip) => {
									const left = millisecondsToPixels(clip.startMs, pixelsPerSecond);
									const width = Math.max(
										16,
										millisecondsToPixels(clip.durationMs, pixelsPerSecond),
									);
									return (
										<button
											key={clip.id}
											type='button'
											onClick={() => clip.sourceId && onSelectSource(clip.sourceId)}
											onPointerDown={(event) => {
												if (track.locked) {
													return;
												}
												event.currentTarget.setPointerCapture(event.pointerId);
												setDrag({ clip, clientX: event.clientX, mode: 'move' });
											}}
											className={cn(
												'absolute top-1 h-10 overflow-hidden rounded border border-white/20 px-2 text-left text-[10px] shadow-sm',
												TRACK_META[track.kind].color,
												track.locked && 'cursor-default opacity-80',
												selectedSourceId === clip.sourceId && 'ring-2 ring-white',
											)}
											style={{ left, width }}
											title={`${clip.label ?? clip.id}\n${(clip.startMs / 1000).toFixed(2)}s - ${((clip.startMs + clip.durationMs) / 1000).toFixed(2)}s`}
										>
											<span className='block truncate'>{clip.label || clip.id}</span>
											<span className='opacity-70'>{(clip.startMs / 1000).toFixed(1)}s</span>
											{!track.locked && (
												<span
													role='presentation'
													onPointerDown={(event) => {
														event.stopPropagation();
														setDrag({ clip, clientX: event.clientX, mode: 'resize-end' });
													}}
													className='absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/20'
												/>
											)}
										</button>
									);
								})}
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
