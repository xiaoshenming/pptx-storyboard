import React, { useRef, useState } from 'react';
import { LuLockKeyhole } from 'react-icons/lu';

import { BindingOverlay, PlayheadLine, TimelineRuler } from './BindingOverlay';
import { toggleNarrationBindingLock } from './narration-binding-actions';
import { createAnimationBindingClickHandler } from './narration-binding-view-model';
import {
	detachTimelineBinding,
	findTimelineClip,
	millisecondsToPixels,
	rebindTimelineClip,
} from './timeline';
import type { TimelineClip, TimelineEditResult, TimelineModel } from './timeline';
import {
	beginTimelineDrag,
	clipAfterEdit,
	dragPassedMoveThreshold,
	planMoveFrame,
	planNarrationMoveFrame,
	planResizeFrame,
	resolveNarrationRelease,
	rollbackNarrationDrag,
	withDragClientX,
} from './timeline-drag-controller';
import type { TimelineDragState } from './timeline-drag-controller';
import { KIND_ICON, TimelineTrackRow } from './TimelineClipCard';
import { TimelineClipContextMenu } from './TimelineClipContextMenu';
import { useTimelineViewport } from './use-timeline-viewport';

interface MultiTrackTimelineProps {
	timeline: TimelineModel;
	selectedSourceId?: string;
	selectedClipId?: string;
	playheadMs?: number;
	/** Narration clip the binding panel is editing; enables click-to-bind on animation clips. */
	editingNarrationClipId?: string;
	onChange: (timeline: TimelineModel) => void;
	onSelectSource: (sourceId: string) => void;
	onSelectClip?: (clipId: string | undefined) => void;
	onSeek?: (playheadMs: number) => void;
	onPlayAll: () => void;
	height?: number | string;
}

export function MultiTrackTimeline({
	timeline,
	selectedSourceId,
	selectedClipId,
	playheadMs,
	editingNarrationClipId,
	onChange,
	onSelectSource,
	onSelectClip,
	onSeek,
	onPlayAll,
	height = 320,
}: MultiTrackTimelineProps): React.ReactElement {
	const [pixelsPerSecond, setPixelsPerSecond] = useState(80);
	const [drag, setDrag] = useState<TimelineDragState | null>(null);
	const dragRef = useRef<TimelineDragState | null>(null);
	const timelineRef = useRef(timeline);
	timelineRef.current = timeline;
	const [menu, setMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
	const [hoveredClipId, setHoveredClipId] = useState<string | undefined>(undefined);
	const [magnetAnchorId, setMagnetAnchorId] = useState<string | null>(null);
	// 刚结束一次真实拖拽（moved）时吞掉紧随的 click，避免落点误触发选中/seek。
	const dragJustMovedRef = useRef(false);
	const scrollViewportRef = useRef<HTMLDivElement>(null);
	const spanMs = timeline.durationMs + 2000;
	const canvasWidth = Math.max(900, millisecondsToPixels(spanMs, pixelsPerSecond));
	const menuClip = menu ? findTimelineClip(timeline, menu.clipId)?.clip : undefined;
	const overlayProps = { timeline, pixelsPerSecond };
	// 拖拽期间悬置绑定的旁白，未磁吸时预告"已解绑"；亚阈值抖动不预告避免闪烁。
	const detachingClipId =
		drag &&
		drag.mode === 'move' &&
		drag.moved &&
		drag.clip.kind === 'narration' &&
		drag.originBinding &&
		!magnetAnchorId
			? drag.clipId
			: undefined;

	useTimelineViewport(scrollViewportRef, timeline, selectedSourceId, pixelsPerSecond);

	const applyEdit = (result: TimelineEditResult) => {
		if (result.accepted) {
			onChange(result.timeline);
		}
	};

	// 点击即绑定：动画卡与菱形锚点共用开关处理；无编辑旁白或轨道锁定时回退旧选中路径。
	const bindingClick = createAnimationBindingClickHandler({
		timeline,
		editingNarrationClipId,
		selectedClipId,
		applyEdit,
		onSelectClip,
		onSeek,
	});

	const commitFrame = (result: TimelineEditResult, clientX: number) => {
		onChange(result.timeline);
		const currentDrag = dragRef.current;
		if (!currentDrag) {
			return;
		}
		const clip = clipAfterEdit(result, currentDrag.clipId) ?? currentDrag.clip;
		const nextDrag = withDragClientX({ ...currentDrag, clip }, clientX);
		dragRef.current = nextDrag;
		setDrag(nextDrag);
	};

	const handlePointerMove = (event: React.PointerEvent) => {
		const currentDrag = dragRef.current;
		if (!currentDrag) {
			return;
		}
		event.preventDefault();
		const clientX = event.clientX;
		// P1 帧 gate：未过拖拽阈值的抖动直接 return，不产生任何 onChange，
		// 避免受控父级采纳中间态后绑定被静默丢弃（plan* 内同样有 gate）。
		if (!dragPassedMoveThreshold(currentDrag, clientX)) {
			return;
		}
		if (currentDrag.mode === 'resize-end') {
			const result = planResizeFrame({
				timeline: timelineRef.current,
				drag: currentDrag,
				clientX,
				pixelsPerSecond,
			});
			if (result) {
				commitFrame(result, clientX);
			}
			return;
		}
		if (currentDrag.clip.kind === 'narration') {
			// 磁吸：候选锚点在阈值内则吸附，松手时按吸附决策绑定。
			const frame = planNarrationMoveFrame({
				timeline: timelineRef.current,
				drag: currentDrag,
				clientX,
				pixelsPerSecond,
			});
			if (!frame) {
				return;
			}
			setMagnetAnchorId(frame.magnetAnchorId);
			commitFrame(frame.result, clientX);
			return;
		}
		const result = planMoveFrame({
			timeline: timelineRef.current,
			drag: currentDrag,
			clientX,
			pixelsPerSecond,
		});
		if (result) {
			commitFrame(result, clientX);
		}
	};

	const interactions = {
		onClick: (clip: TimelineClip) => {
			if (dragJustMovedRef.current) {
				dragJustMovedRef.current = false;
				return;
			}
			// 点击即绑定：动画卡点击被绑定开关消费时跳过旧的选中路径。
			if (bindingClick.handleClick(clip)) {
				return;
			}
			onSelectClip?.(selectedClipId === clip.id ? undefined : clip.id);
			if (clip.sourceId) {
				onSelectSource(clip.sourceId);
			}
			// 选中动画或旁白时把播放头带到片段起点，便于检查音画。
			if (onSeek && (clip.kind === 'animation' || clip.kind === 'narration')) {
				onSeek(clip.startMs);
			}
		},
		onPointerDown: (
			clip: TimelineClip,
			trackLocked: boolean | undefined,
			event: React.PointerEvent<HTMLButtonElement>,
		) => {
			// 右键/中键属于 context menu 与滚动，不启动拖拽。
			if (event.button !== 0) {
				return;
			}
			// 绑定锁定的旁白禁止拖动。
			if (trackLocked || (clip.kind === 'narration' && clip.binding?.locked)) {
				return;
			}
			event.currentTarget.setPointerCapture(event.pointerId);
			event.preventDefault();
			dragJustMovedRef.current = false;
			const nextDrag = beginTimelineDrag(clip, 'move', event.clientX);
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		},
		onContextMenu: (clip: TimelineClip, event: React.MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			setMenu({ clipId: clip.id, x: event.clientX, y: event.clientY });
		},
		onResizePointerDown: (clip: TimelineClip, event: React.PointerEvent<HTMLSpanElement>) => {
			// 锁定语义含时长：锁定的旁白同样禁止 resize。
			if (clip.kind === 'narration' && clip.binding?.locked) {
				return;
			}
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			event.preventDefault();
			dragJustMovedRef.current = false;
			const nextDrag = beginTimelineDrag(clip, 'resize-end', event.clientX);
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		},
		onHoverChange: setHoveredClipId,
	};

	return (
		<section
			className='flex min-h-0 flex-col overflow-hidden bg-slate-950 text-white'
			style={{ height }}
			data-testid='storyboard-timeline'
		>
			<header className='flex h-11 items-center gap-3 border-b border-white/10 px-4 text-xs'>
				<strong>专业时间轴</strong>
				<span className='text-slate-500'>旁白拖到锚点即绑定，自由落点解绑</span>
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
			<div
				className='flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden'
				style={{
					height: typeof height === 'number' ? Math.max(120, height - 44) : undefined,
				}}
			>
				<div className='w-28 shrink-0 border-r border-white/10 pt-6'>
					{timeline.tracks.map((track) => (
						<div
							key={track.id}
							className='flex h-12 items-center gap-2 border-b border-white/5 px-3 text-xs text-slate-300'
						>
							{KIND_ICON[track.kind]}
							<span>{track.name}</span>
							{track.locked && <LuLockKeyhole className='ml-auto h-3 w-3 text-slate-500' />}
						</div>
					))}
				</div>
				<div
					ref={scrollViewportRef}
					data-timeline-scroll-viewport
					className='pptx-storyboard-timeline-scroll min-w-0 flex-1 overflow-x-auto overflow-y-visible'
					onPointerMove={handlePointerMove}
					onPointerUp={() => {
						const currentDrag = dragRef.current;
						if (currentDrag?.moved) {
							dragJustMovedRef.current = true;
						}
						const release = currentDrag
							? resolveNarrationRelease({
									timeline: timelineRef.current,
									drag: currentDrag,
									pixelsPerSecond,
								})
							: undefined;
						if (release?.result) {
							applyEdit(release.result);
						}
						setMagnetAnchorId(null);
						dragRef.current = null;
						setDrag(null);
					}}
					onPointerCancel={() => {
						// 回弹：开始时有绑定的旁白按原绑定 rebind 回锚点位置。
						const currentDrag = dragRef.current;
						const rollback = currentDrag
							? rollbackNarrationDrag({ timeline: timelineRef.current, drag: currentDrag })
							: undefined;
						if (rollback?.accepted) {
							onChange(rollback.timeline);
						}
						setMagnetAnchorId(null);
						dragRef.current = null;
						setDrag(null);
					}}
				>
					<div className='relative' style={{ width: canvasWidth }}>
						<TimelineRuler {...overlayProps} onSeek={onSeek} />
						{timeline.tracks.map((track) => (
							<TimelineTrackRow
								key={track.id}
								{...overlayProps}
								track={track}
								selectedClipId={selectedClipId}
								selectedSourceId={selectedSourceId}
								detachingClipId={detachingClipId}
								bindingHint={bindingClick.hintFor}
								interactions={interactions}
							/>
						))}
						<BindingOverlay
							{...overlayProps}
							canvasWidth={canvasWidth}
							selectedClipId={selectedClipId}
							hoveredClipId={hoveredClipId}
							magnetAnchorId={magnetAnchorId}
							onAnchorClick={bindingClick.handleClick}
							anchorHint={bindingClick.hintFor}
						/>
						{playheadMs !== undefined && <PlayheadLine {...overlayProps} playheadMs={playheadMs} />}
					</div>
				</div>
			</div>
			{menu && menuClip && (
				<TimelineClipContextMenu
					timeline={timeline}
					clip={menuClip}
					x={menu.x}
					y={menu.y}
					onClose={() => setMenu(null)}
					onLockToggle={(locked) =>
						applyEdit(toggleNarrationBindingLock(timeline, menuClip.id, locked))
					}
					onDetach={() => applyEdit(detachTimelineBinding(timeline, menuClip.id))}
					onRebindDefault={(binding) =>
						applyEdit(rebindTimelineClip(timeline, menuClip.id, binding))
					}
					onLocateSource={onSelectSource}
				/>
			)}
		</section>
	);
}
