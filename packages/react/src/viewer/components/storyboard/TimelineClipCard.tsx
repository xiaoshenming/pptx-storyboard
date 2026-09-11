import React from 'react';
import {
	LuAudioLines,
	LuCaptions,
	LuFilm,
	LuLink,
	LuLockKeyhole,
	LuSparkles,
} from 'react-icons/lu';

import { cn } from '../../utils';
import { AnimationGroupBrackets, animationGroupBrackets } from './animation-group-brackets';
import { clipMetadataString, resolveBindingBadge } from './narration-binding-actions';
import { presetClassLabel, triggerLabel } from './storyboard-animation-labels';
import { findAnimationAnchorClip, millisecondsToPixels } from './timeline';
import type { TimelineClip, TimelineModel, TimelineTrack, TimelineTrackKind } from './timeline';

const KIND_COLOR: Record<TimelineTrackKind, string> = {
	visual: 'bg-sky-500/90',
	animation: 'bg-violet-500/90',
	narration: 'bg-emerald-500/90',
	subtitle: 'bg-amber-500/90',
};

export const KIND_ICON: Record<TimelineTrackKind, React.ReactNode> = {
	visual: <LuFilm className='h-3 w-3 shrink-0' />,
	animation: <LuSparkles className='h-3 w-3 shrink-0' />,
	narration: <LuAudioLines className='h-3 w-3 shrink-0' />,
	subtitle: <LuCaptions className='h-3 w-3 shrink-0' />,
};

export interface TimelineClipCardProps {
	clip: TimelineClip;
	trackKind: TimelineTrackKind;
	trackLocked?: boolean;
	left: number;
	width: number;
	/** Clip-level selection wins over the shot-level highlight. */
	clipSelected: boolean;
	sourceSelected: boolean;
	/** Binding badge text (undefined when the clip is unbound). */
	badge?: string;
	/** Hover title for the badge/card: the anchor's target and trigger. */
	badgeTitle?: string;
	/** True while the clip is dragged to a free landing that releases its binding. */
	detaching?: boolean;
	/** Appended to the hover title, e.g. the click-to-bind affordance hint. */
	bindingHint?: string;
	onClick: () => void;
	onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
	onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
	onResizePointerDown: (event: React.PointerEvent<HTMLSpanElement>) => void;
	/** Reports hover enter/exit so the binding overlay can show its line. */
	onHoverChange?: (clipId: string | undefined) => void;
}

/** Animation cards read `A1 · 进入` on line 1 and `目标 + 触发方式` on line 2. */
function AnimationClipBody({ clip }: { clip: TimelineClip }): React.ReactElement {
	const line1 = [
		clipMetadataString(clip.metadata, 'anchorLabel'),
		presetClassLabel(clipMetadataString(clip.metadata, 'presetClass')),
	]
		.filter(Boolean)
		.join(' · ');
	const line2 = [
		clipMetadataString(clip.metadata, 'targetLabel'),
		triggerLabel(clipMetadataString(clip.metadata, 'trigger')),
	]
		.filter(Boolean)
		.join(' ');
	return (
		<span className='block'>
			<span className='block truncate font-medium'>{line1}</span>
			{line2 && <span className='block truncate opacity-80'>{line2}</span>}
		</span>
	);
}

function NarrationClipBody({
	clip,
	badge,
	badgeTitle,
}: {
	clip: TimelineClip;
	badge?: string;
	badgeTitle?: string;
}): React.ReactElement {
	return (
		<span className='block'>
			<span className='block truncate'>{clip.label || clip.id}</span>
			{badge ? (
				<span
					title={badgeTitle}
					className='block truncate rounded bg-black/30 px-1 text-emerald-100'
				>
					{badge}
				</span>
			) : (
				<span className='opacity-70'>{(clip.startMs / 1000).toFixed(1)}s</span>
			)}
		</span>
	);
}

/** Read-only hover info for a narration binding: the anchor's target + trigger. */
export function narrationBindingTitle(
	timeline: TimelineModel,
	clip: TimelineClip,
): string | undefined {
	const anchor = clip.binding
		? findAnimationAnchorClip(timeline, clip.binding.anchorId)
		: undefined;
	if (!anchor) {
		return undefined;
	}
	const meta = (key: string) => clipMetadataString(anchor.metadata, key);
	return (
		[meta('targetLabel'), triggerLabel(meta('trigger'))].filter(Boolean).join(' · ') || undefined
	);
}

export function TimelineClipCard({
	clip,
	trackKind,
	trackLocked,
	left,
	width,
	clipSelected,
	sourceSelected,
	badge,
	badgeTitle,
	detaching,
	bindingHint,
	onClick,
	onPointerDown,
	onContextMenu,
	onResizePointerDown,
	onHoverChange,
}: TimelineClipCardProps): React.ReactElement {
	const timeRange = `${(clip.startMs / 1000).toFixed(2)}s - ${((clip.startMs + clip.durationMs) / 1000).toFixed(2)}s`;
	const narrationTitle = trackKind === 'narration' ? badgeTitle : undefined;
	const title =
		trackKind === 'subtitle'
			? `${clip.label || clip.id}\n${timeRange}\n时间继承自旁白`
			: [clip.label || clip.id, timeRange, narrationTitle, bindingHint].filter(Boolean).join('\n');
	// 锁定语义含时长：锁定旁白（及整轨锁定）不渲染 resize 手柄。
	const resizeDisabled =
		trackLocked || (trackKind === 'narration' && clip.binding?.locked === true);
	return (
		<button
			type='button'
			data-clip-id={clip.id}
			aria-haspopup='menu'
			onClick={onClick}
			onPointerDown={onPointerDown}
			onContextMenu={onContextMenu}
			onPointerEnter={() => onHoverChange?.(clip.id)}
			onPointerLeave={() => onHoverChange?.(undefined)}
			className={cn(
				'absolute top-1 flex h-10 flex-col justify-center overflow-hidden rounded border border-white/20 px-2 text-left text-[10px] shadow-sm',
				KIND_COLOR[trackKind],
				trackKind === 'animation' && 'gap-0.5',
				trackLocked && 'cursor-default opacity-80',
				clipSelected && 'z-10 ring-2 ring-white',
				!clipSelected && sourceSelected && 'ring-1 ring-white/60',
			)}
			style={{ left, width }}
			title={title}
		>
			<span className='flex items-center gap-1'>
				{KIND_ICON[trackKind]}
				{trackKind === 'animation' ? (
					<AnimationClipBody clip={clip} />
				) : trackKind === 'narration' ? (
					<NarrationClipBody clip={clip} badge={badge} badgeTitle={badgeTitle} />
				) : (
					<span className='block truncate'>
						{trackKind === 'subtitle' && (
							<LuLink className='mr-1 inline h-2.5 w-2.5 align-baseline' />
						)}
						{clip.label || clip.id}
					</span>
				)}
			</span>
			{(trackKind === 'visual' || trackKind === 'subtitle') && (
				<span className='opacity-70'>{(clip.startMs / 1000).toFixed(1)}s</span>
			)}
			{clip.binding?.locked && (
				<LuLockKeyhole className='absolute right-1 top-1 h-2.5 w-2.5 text-white/90' />
			)}
			{detaching && (
				<span className='absolute inset-x-1 bottom-0.5 rounded bg-black/50 px-1 text-center text-[9px] text-white/70'>
					已解绑
				</span>
			)}
			{!resizeDisabled && (
				<span
					role='presentation'
					data-resize-handle={clip.id}
					onPointerDown={onResizePointerDown}
					className='absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/20'
				/>
			)}
		</button>
	);
}

export interface TimelineClipInteractions {
	onClick: (clip: TimelineClip) => void;
	onPointerDown: (
		clip: TimelineClip,
		trackLocked: boolean | undefined,
		event: React.PointerEvent<HTMLButtonElement>,
	) => void;
	onContextMenu: (clip: TimelineClip, event: React.MouseEvent<HTMLButtonElement>) => void;
	onResizePointerDown: (clip: TimelineClip, event: React.PointerEvent<HTMLSpanElement>) => void;
	onHoverChange: (clipId: string | undefined) => void;
}

export interface TimelineTrackRowProps {
	track: TimelineTrack;
	timeline: TimelineModel;
	pixelsPerSecond: number;
	selectedClipId?: string;
	selectedSourceId?: string;
	/** Clip whose drag suspends a binding; shows the detach hint while unmagnetized. */
	detachingClipId?: string;
	/** Per-clip hover title hint, e.g. the click-to-bind affordance. */
	bindingHint?: (clip: TimelineClip) => string | undefined;
	interactions: TimelineClipInteractions;
}

export function TimelineTrackRow({
	track,
	timeline,
	pixelsPerSecond,
	selectedClipId,
	selectedSourceId,
	detachingClipId,
	bindingHint,
	interactions,
}: TimelineTrackRowProps): React.ReactElement {
	return (
		<div className='relative h-12 border-b border-white/5 bg-white/[0.02]'>
			{track.kind === 'animation' && (
				<AnimationGroupBrackets brackets={animationGroupBrackets(track, pixelsPerSecond)} />
			)}
			{track.clips.map((clip) => (
				<TimelineClipCard
					key={clip.id}
					clip={clip}
					trackKind={track.kind}
					trackLocked={track.locked}
					left={millisecondsToPixels(clip.startMs, pixelsPerSecond)}
					width={Math.max(16, millisecondsToPixels(clip.durationMs, pixelsPerSecond))}
					clipSelected={selectedClipId === clip.id}
					sourceSelected={selectedSourceId !== undefined && clip.sourceId === selectedSourceId}
					badge={resolveBindingBadge(timeline, clip)}
					badgeTitle={narrationBindingTitle(timeline, clip)}
					detaching={detachingClipId === clip.id}
					bindingHint={bindingHint?.(clip)}
					onClick={() => interactions.onClick(clip)}
					onPointerDown={(event) => interactions.onPointerDown(clip, track.locked, event)}
					onContextMenu={(event) => interactions.onContextMenu(clip, event)}
					onResizePointerDown={(event) => interactions.onResizePointerDown(clip, event)}
					onHoverChange={interactions.onHoverChange}
				/>
			))}
		</div>
	);
}
