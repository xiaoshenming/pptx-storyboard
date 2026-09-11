import React from 'react';
import { LuLink } from 'react-icons/lu';

import {
	animationClipOptionLabel,
	animationMetadata,
	bindingOutcomePreview,
	splitAnimationClips,
	suggestedAnchorId,
} from './narration-binding-view-model';
import {
	bindingBadgeText,
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
	describeTimelineBinding,
} from './timeline';
import type { TimelineBinding, TimelineBindingMode, TimelineClip, TimelineModel } from './timeline';

// 兼容再导出：StoryboardScriptPanel 与既有测试从这里取这些名字。
export {
	animationClipOptionLabel,
	scriptDriftFeedback,
	suggestedAnchorId,
} from './narration-binding-view-model';
export type { ScriptDriftFeedback } from './narration-binding-view-model';

export interface NarrationBindingEditorProps {
	narrationClip?: TimelineClip;
	animationClips: TimelineClip[];
	onChange: (binding: TimelineBinding | undefined) => void;
	/**
	 * Real timeline for the outcome preview; when absent one is derived from
	 * `animationClips` (the binding maths only reads the animation track).
	 */
	timeline?: TimelineModel;
}

const BINDING_MODES: readonly TimelineBindingMode[] = [
	'before-animation',
	'with-animation',
	'after-animation',
];

const FREE_TIME_OPTION = '自由时间（未绑定）';
const OWN_GROUP_LABEL = '本分镜的动画';
const OTHER_GROUP_LABEL = '其他分镜的动画（高级）';
export const BINDING_HINT =
	'绑定后，此旁白的开始时间会跟随所选动画：动画同时=与动画一起出现，动画前=在动画开始前讲完，动画后=等动画播完再讲。';
export const STATIC_SHOT_HINT =
	'当前分镜没有自己的动画，旁白保持自由时间即可。如需跟随其他分镜的动画，可在时间轴拖动旁白。';
export const STATIC_SHOT_ADVANCED = '高级：跟随其他分镜动画';

function EditorPanel({ children }: { children: React.ReactNode }): React.ReactElement {
	return (
		<div className='rounded-xl border border-slate-200 p-4'>
			<div className='mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800'>
				<LuLink /> 动画绑定
			</div>
			{children}
		</div>
	);
}

function unavailableState(): React.ReactElement {
	return (
		<EditorPanel>
			<p className='text-xs text-slate-400'>当前分镜没有可绑定的动画</p>
		</EditorPanel>
	);
}

interface BindingFormProps {
	narrationClip: TimelineClip;
	animationClips: TimelineClip[];
	timeline: TimelineModel;
	onChange: (binding: TimelineBinding | undefined) => void;
}

function renderGroup(label: string, clips: TimelineClip[]): React.ReactElement | null {
	if (clips.length === 0) {
		return null;
	}
	return (
		<optgroup key={label} label={label}>
			{clips.map((clip) => (
				<option key={clip.id} value={clip.id}>
					{animationClipOptionLabel(clip)}
				</option>
			))}
		</optgroup>
	);
}

function UnboundSuggestion({
	animationClips,
	sourceId,
}: {
	animationClips: TimelineClip[];
	sourceId: string | undefined;
}): React.ReactElement | null {
	const anchorId = suggestedAnchorId(animationClips, sourceId);
	const suggestion = anchorId ? animationClips.find((clip) => clip.id === anchorId) : undefined;
	if (!suggestion) {
		return null;
	}
	return (
		<p className='mt-2 text-[11px] text-slate-400'>
			建议绑定：{animationClipOptionLabel(suggestion)}（本分镜第一个出现内容的动画）
		</p>
	);
}

function BindingForm({
	narrationClip,
	animationClips,
	timeline,
	onChange,
}: BindingFormProps): React.ReactElement {
	const binding = narrationClip.binding;
	const { own, others } = splitAnimationClips(animationClips, narrationClip.sourceId);
	const anchorClip = binding
		? animationClips.find((clip) => clip.id === binding.anchorId)
		: undefined;
	const anchorLabel = anchorClip ? (animationMetadata(anchorClip).anchorLabel ?? '') : '';
	const preview = bindingOutcomePreview(timeline, narrationClip);
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
		<>
			<label className='block text-xs text-slate-500'>
				跟随动画（锚点）
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
					{renderGroup(OWN_GROUP_LABEL, own)}
					{renderGroup(OTHER_GROUP_LABEL, others)}
				</select>
			</label>
			{binding && preview && <p className='mt-2 text-[11px] text-amber-600'>{preview}</p>}
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
			{!binding && (
				<UnboundSuggestion animationClips={animationClips} sourceId={narrationClip.sourceId} />
			)}
		</>
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
	timeline,
}: NarrationBindingEditorProps): React.ReactElement {
	if (!narrationClip || animationClips.length === 0) {
		return unavailableState();
	}
	const { own } = splitAnimationClips(animationClips, narrationClip.sourceId);
	const form = (
		<BindingForm
			narrationClip={narrationClip}
			animationClips={animationClips}
			timeline={timeline ?? createTimelineModel([createTimelineTrack('animation', animationClips)])}
			onChange={onChange}
		/>
	);
	if (own.length === 0) {
		// 静态分镜：能力保留在折叠的"高级"区里，但不打扰主流程。
		return (
			<EditorPanel>
				<p className='text-xs leading-5 text-slate-500'>{STATIC_SHOT_HINT}</p>
				<details className='mt-3'>
					<summary className='cursor-pointer select-none text-xs font-semibold text-slate-600'>
						{STATIC_SHOT_ADVANCED}
					</summary>
					<div className='mt-3'>{form}</div>
				</details>
			</EditorPanel>
		);
	}
	return (
		<EditorPanel>
			<p className='text-xs leading-5 text-slate-500'>{BINDING_HINT}</p>
			<div className='mt-3'>{form}</div>
		</EditorPanel>
	);
}
