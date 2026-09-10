import React from 'react';
import { LuLink } from 'react-icons/lu';

import { defaultBindingForNarration } from './narration-binding-actions';
import { presetClassLabel } from './storyboard-animation-labels';
import {
	bindingBadgeText,
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
	describeTimelineBinding,
	estimateScriptDuration,
} from './timeline';
import type { TimelineBinding, TimelineBindingMode, TimelineClip } from './timeline';

export interface NarrationBindingEditorProps {
	narrationClip?: TimelineClip;
	animationClips: TimelineClip[];
	onChange: (binding: TimelineBinding | undefined) => void;
}

interface AnimationClipMetadata {
	anchorLabel?: string;
	targetLabel?: string;
	presetClass?: string;
}

const BINDING_MODES: readonly TimelineBindingMode[] = [
	'before-animation',
	'with-animation',
	'after-animation',
];

const FREE_TIME_OPTION = '自由时间（未绑定）';

function animationMetadata(clip: TimelineClip): AnimationClipMetadata {
	return (clip.metadata ?? {}) as AnimationClipMetadata;
}

/** `A1 · 进入 · 数字 60`, the canonical option label for an animation anchor. */
export function animationClipOptionLabel(clip: TimelineClip): string {
	const meta = animationMetadata(clip);
	const target = meta.targetLabel ?? clip.label;
	return [meta.anchorLabel ?? clip.id, presetClassLabel(meta.presetClass), target]
		.filter(Boolean)
		.join(' · ');
}

/**
 * Default anchor suggestion for an unbound narration clip. Delegates to the
 * canonical `defaultBindingForNarration` (earliest animation of the same shot
 * by startMs, else the first animation on the timeline) so the editor, the
 * context menu and the drop logic share one default; returns its anchorId.
 */
export function suggestedAnchorId(
	animationClips: TimelineClip[],
	sourceId?: string,
): string | undefined {
	const timeline = createTimelineModel([createTimelineTrack('animation', animationClips)]);
	const probe: TimelineClip = {
		id: 'suggested-anchor-probe',
		trackId: 'track-narration',
		kind: 'narration',
		startMs: 0,
		durationMs: 0,
		sourceId,
	};
	return defaultBindingForNarration(timeline, probe)?.anchorId;
}

export interface ScriptDriftFeedback {
	direction: 'longer' | 'shorter';
	/** Absolute drift in seconds, one decimal place. */
	seconds: string;
}

/**
 * D1 feedback: compares the script's estimated narration duration against the
 * narration clip's current duration. Returns undefined when within tolerance
 * (no user-facing warning needed).
 */
export function scriptDriftFeedback(
	script: string,
	currentDurationMs: number | undefined,
	toleranceMs = 500,
): ScriptDriftFeedback | undefined {
	if (currentDurationMs === undefined) {
		return undefined;
	}
	const driftMs = estimateScriptDuration(script) - currentDurationMs;
	if (Math.abs(driftMs) <= toleranceMs) {
		return undefined;
	}
	return {
		direction: driftMs > 0 ? 'longer' : 'shorter',
		seconds: (Math.abs(driftMs) / 1000).toFixed(1),
	};
}

function unavailableState(): React.ReactElement {
	return (
		<div className='rounded-xl border border-slate-200 p-4'>
			<p className='text-sm font-semibold text-slate-800'>动画绑定</p>
			<p className='mt-2 text-xs text-slate-400'>当前分镜没有可绑定的动画</p>
		</div>
	);
}

// 契约说明（工单 C3）：完全受控组件，不做本地 state；每次编辑都通过
// onChange(createTimelineBinding(...)) 抛出完整 binding（保留未变字段），
// 解绑抛 undefined。未绑定时先选锚点才会以"动画同时 / 0ms / 不锁定"
// 为默认建立绑定，其余控件在未绑定期间禁用。
export function NarrationBindingEditor({
	narrationClip,
	animationClips,
	onChange,
}: NarrationBindingEditorProps): React.ReactElement {
	if (!narrationClip || animationClips.length === 0) {
		return unavailableState();
	}
	const binding = narrationClip.binding;
	const anchorClip = binding
		? animationClips.find((clip) => clip.id === binding.anchorId)
		: undefined;
	const anchorLabel = anchorClip ? (animationMetadata(anchorClip).anchorLabel ?? '') : '';
	const suggestionId = suggestedAnchorId(animationClips, narrationClip.sourceId);
	const suggestion = suggestionId
		? animationClips.find((clip) => clip.id === suggestionId)
		: undefined;
	const update = (patch: Partial<TimelineBinding>): void => {
		if (!binding) {
			return;
		}
		onChange(
			createTimelineBinding(
				patch.anchorId ?? binding.anchorId,
				patch.mode ?? binding.mode,
				patch.offsetMs ?? binding.offsetMs,
				patch.locked ?? binding.locked,
			),
		);
	};
	return (
		<div className='rounded-xl border border-slate-200 p-4'>
			<div className='mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800'>
				<LuLink /> 动画绑定
			</div>
			<label className='block text-xs text-slate-500'>
				锚点动画
				<select
					value={binding?.anchorId ?? ''}
					onChange={(event) => {
						const anchorId = event.target.value;
						if (!anchorId) {
							// 已绑定时选"自由时间"等价于解除绑定。
							if (binding) {
								onChange(undefined);
							}
							return;
						}
						if (binding) {
							update({ anchorId });
						} else {
							onChange(createTimelineBinding(anchorId, 'with-animation', 0, false));
						}
					}}
					className='mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-400 focus:bg-white'
				>
					<option value=''>{FREE_TIME_OPTION}</option>
					{animationClips.map((clip) => (
						<option key={clip.id} value={clip.id}>
							{animationClipOptionLabel(clip)}
						</option>
					))}
				</select>
			</label>
			<div className='mt-3'>
				<p className='text-xs text-slate-500'>绑定模式</p>
				<div className='mt-1 flex rounded-lg bg-slate-100 p-1 text-xs'>
					{BINDING_MODES.map((mode) => {
						const active = binding?.mode === mode;
						return (
							<button
								key={mode}
								type='button'
								disabled={!binding}
								aria-pressed={active}
								onClick={() => update({ mode })}
								className={
									active
										? 'flex-1 rounded-md bg-white px-1 py-1.5 font-semibold text-orange-600 shadow-sm'
										: 'flex-1 rounded-md px-1 py-1.5 text-slate-500 disabled:text-slate-300'
								}
							>
								{describeTimelineBinding(mode)}
							</button>
						);
					})}
				</div>
			</div>
			<div className='mt-3 flex items-center gap-2'>
				<label className='flex items-center gap-2 text-xs text-slate-500'>
					偏移 (ms)
					<input
						type='number'
						step={100}
						value={binding?.offsetMs ?? 0}
						disabled={!binding}
						onChange={(event) => {
							if (event.target.value === '' || !binding) {
								return;
							}
							const offsetMs = Number(event.target.value);
							if (Number.isFinite(offsetMs)) {
								update({ offsetMs });
							}
						}}
						className='w-24 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-orange-400 focus:bg-white disabled:text-slate-300'
					/>
				</label>
				{binding && (
					<span className='ml-auto rounded-full bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-600'>
						{bindingBadgeText(binding, anchorLabel)}
					</span>
				)}
			</div>
			<label className='mt-3 flex items-center gap-2 text-xs text-slate-600'>
				<input
					type='checkbox'
					checked={binding?.locked ?? false}
					disabled={!binding}
					onChange={(event) => update({ locked: event.target.checked })}
					className='accent-orange-500'
				/>
				锁定
				<span className='text-slate-400'>锁定后此旁白不能被拖动</span>
			</label>
			<button
				type='button'
				disabled={!binding}
				onClick={() => onChange(undefined)}
				className='mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-orange-300 hover:text-orange-600 disabled:opacity-50'
			>
				解除绑定
			</button>
			{!binding && suggestion && (
				<p className='mt-2 text-[11px] text-slate-400'>
					建议绑定：{animationClipOptionLabel(suggestion)}
				</p>
			)}
		</div>
	);
}
