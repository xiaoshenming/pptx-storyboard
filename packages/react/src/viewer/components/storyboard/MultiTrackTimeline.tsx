import React, { useRef, useState } from 'react';
import { LuLockKeyhole } from 'react-icons/lu';

import { BindingOverlay, PlayheadLine, TimelineRuler } from './BindingOverlay';
import { toggleNarrationBindingLock } from './narration-binding-actions';
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

interface MultiTrackTimelineProps {
	timeline: TimelineModel;
	selectedSourceId?: string;
	selectedClipId?: string;
	playheadMs?: number;
	onChange: (timeline: TimelineModel) => void;
	onSelectSource: (sourceId: string) => void;
	onSelectClip?: (clipId: string | undefined) => void;
	onSeek?: (playheadMs: number) => void;
	onPlayAll: () => void;
}

export function MultiTrackTimeline({
	timeline,
	selectedSourceId,
	selectedClipId,
	playheadMs,
	onChange,
	onSelectSource,
	onSelectClip,
	onSeek,
	onPlayAll,
}: MultiTrackTimelineProps): React.ReactElement {
	const [pixelsPerSecond, setPixelsPerSecond] = useState(80);
	const [drag, setDrag] = useState<TimelineDragState | null>(null);
	const [menu, setMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
	const [hoveredClipId, setHoveredClipId] = useState<string | undefined>(undefined);
	const [magnetAnchorId, setMagnetAnchorId] = useState<string | null>(null);
	// 刚结束一次真实拖拽（moved）时吞掉紧随的 click，避免落点误触发选中/seek。
	const dragJustMovedRef = useRef(false);
	const spanMs = timeline.durationMs + 2000;
	const canvasWidth = Math.max(900, millisecondsToPixels(spanMs, pixelsPerSecond));
	const menuClip = menu ? findTimelineClip(timeline, menu.clipId)?.clip : undefined;
	const overlayProps = { timeline, pixelsPerSecond };
	// 拖拽期间悬置了绑定的旁白，未磁吸时给出"已解绑"预告。
	// 未过移动阈值的抖动不会提交任何帧，此时不预告，避免徽章闪烁误导。
	const detachingClipId =
		drag &&
		drag.mode === 'move' &&
		drag.moved &&
		drag.clip.kind === 'narration' &&
		drag.originBinding &&
		!magnetAnchorId
			? drag.clipId
			: undefined;

	const applyEdit = (result: TimelineEditResult) => {
		if (result.accepted) {
			onChange(result.timeline);
		}
	};

	const commitFrame = (result: TimelineEditResult, clientX: number) => {
		onChange(result.timeline);
		if (!drag) {
			return;
		}
		const clip = clipAfterEdit(result, drag.clipId) ?? drag.clip;
		setDrag(withDragClientX({ ...drag, clip }, clientX));
	};

	const handlePointerMove = (event: React.PointerEvent) => {
		if (!drag) {
			return;
		}
		const clientX = event.clientX;
		// P1 帧 gate：未过拖拽阈值的抖动直接 return，不产生任何 onChange，
		// 避免受控父级采纳中间态后绑定被静默丢弃（plan* 内同样有 gate）。
		if (!dragPassedMoveThreshold(drag, clientX)) {
			return;
		}
		if (drag.mode === 'resize-end') {
			const result = planResizeFrame({ timeline, drag, clientX, pixelsPerSecond });
			if (result) {
				commitFrame(result, clientX);
			}
			return;
		}
		if (drag.clip.kind === 'narration') {
			// 磁吸：候选锚点在阈值内则吸附，松手时按吸附决策绑定。
			const frame = planNarrationMoveFrame({ timeline, drag, clientX, pixelsPerSecond });
			if (!frame) {
				return;
			}
			setMagnetAnchorId(frame.magnetAnchorId);
			commitFrame(frame.result, clientX);
			return;
		}
		const result = planMoveFrame({ timeline, drag, clientX, pixelsPerSecond });
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
			dragJustMovedRef.current = false;
			setDrag(beginTimelineDrag(clip, 'move', event.clientX));
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
			dragJustMovedRef.current = false;
			setDrag(beginTimelineDrag(clip, 'resize-end', event.clientX));
		},
		onHoverChange: setHoveredClipId,
	};

	return (
		<section className='h-[270px] shrink-0 border-t border-slate-200 bg-slate-950 text-white'>
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
			<div className='flex h-[226px]'>
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
					className='min-w-0 flex-1 overflow-auto'
					onPointerMove={handlePointerMove}
					onPointerUp={() => {
						if (drag?.moved) {
							dragJustMovedRef.current = true;
						}
						const release = drag
							? resolveNarrationRelease({ timeline, drag, pixelsPerSecond })
							: undefined;
						if (release?.result) {
							applyEdit(release.result);
						}
						setMagnetAnchorId(null);
						setDrag(null);
					}}
					onPointerCancel={() => {
						// 回弹：开始时有绑定的旁白按原绑定 rebind 回锚点位置。
						const rollback = drag ? rollbackNarrationDrag({ timeline, drag }) : undefined;
						if (rollback?.accepted) {
							onChange(rollback.timeline);
						}
						setMagnetAnchorId(null);
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
								interactions={interactions}
							/>
						))}
						<BindingOverlay
							{...overlayProps}
							canvasWidth={canvasWidth}
							selectedClipId={selectedClipId}
							hoveredClipId={hoveredClipId}
							magnetAnchorId={magnetAnchorId}
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
