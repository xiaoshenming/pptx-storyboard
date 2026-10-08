import type { PptxSlide } from 'pptx-viewer-core';
import React, { useState } from 'react';
import { LuAudioLines, LuBot, LuCaptions, LuFilm, LuType } from 'react-icons/lu';

import { NarrationBindingEditor, scriptDriftFeedback } from './NarrationBindingEditor';
import type { StoryboardShot } from './storyboard-model';
import { StoryboardVoicePanel } from './StoryboardVoicePanel';
import { estimateScriptDuration } from './timeline';
import type { TimelineBinding, TimelineClip } from './timeline';

type InspectorTab = 'text' | 'voice' | 'subtitles' | 'animation';

interface StoryboardScriptPanelProps {
	shot: StoryboardShot;
	slide: PptxSlide;
	onGenerateNarration?: () => void;
	scriptProtected?: boolean;
	onScriptProtectionChange?: (locked: boolean) => void;
	ttsEndpoint?: string;
	voiceType: number;
	speed: number;
	audioPreview?: { url: string; durationMs: number; taskId: string };
	narrationClip?: TimelineClip;
	animationClips?: TimelineClip[];
	onBindingChange?: (binding: TimelineBinding | undefined) => void;
	onScriptChange: (script: string) => void;
	onVoiceTypeChange: (voiceType: number) => void;
	onSpeedChange: (speed: number) => void;
	onAudioPreview: (preview: { url: string; durationMs: number; taskId: string }) => void;
	onSubtitlesEnabledChange: (enabled: boolean) => void;
}

const tabs: Array<{ id: InspectorTab; label: string; icon: React.ReactNode }> = [
	{ id: 'text', label: '文本', icon: <LuType /> },
	{ id: 'voice', label: '配音', icon: <LuAudioLines /> },
	{ id: 'subtitles', label: '字幕', icon: <LuCaptions /> },
	{ id: 'animation', label: '动画', icon: <LuFilm /> },
];

export function StoryboardScriptPanel({
	shot,
	onGenerateNarration,
	scriptProtected,
	onScriptProtectionChange,
	ttsEndpoint,
	speed,
	audioPreview,
	narrationClip,
	animationClips,
	onBindingChange,
	onScriptChange,
	onSpeedChange,
	onAudioPreview,
	onSubtitlesEnabledChange,
}: StoryboardScriptPanelProps): React.ReactElement {
	const [activeTab, setActiveTab] = useState<InspectorTab>('text');
	const drift = scriptDriftFeedback(shot.script, narrationClip?.durationMs);
	return (
		<aside className='flex min-h-0 w-[380px] shrink-0 flex-col border-l border-slate-700 bg-[#171821] text-slate-100'>
			<div className='border-b border-slate-700 px-4 py-3'>
				<div className='flex items-center gap-2'>
					<div className='min-w-0 flex-1'>
						<h2 className='truncate text-sm font-semibold'>{shot.label}</h2>
						<p className='mt-1 truncate text-xs text-slate-400'>
							{shot.effectLabel || '静态分镜'} · 旁白节点
						</p>
					</div>
					<span className='rounded bg-pink-500/15 px-2 py-1 text-[10px] font-medium text-pink-300'>
						当前节点
					</span>
				</div>
			</div>
			<div className='grid grid-cols-4 border-b border-slate-700 bg-[#1d1e28]'>
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type='button'
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-xs transition ${activeTab === tab.id ? 'border-pink-500 bg-pink-500/5 text-pink-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
					>
						<span className='text-sm'>{tab.icon}</span>
						{tab.label}
					</button>
				))}
			</div>
			<div className='min-h-0 flex-1 overflow-y-auto'>
				{activeTab === 'text' && (
					<div className='space-y-4 p-4'>
						<textarea
							value={shot.script}
							maxLength={4000}
							onChange={(event) => onScriptChange(event.target.value)}
							placeholder='输入当前旁白节点的讲解稿...'
							className='min-h-[230px] w-full resize-y rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm leading-7 text-slate-100 outline-none focus:border-pink-500'
						/>
						<div className='flex text-xs text-slate-500'>
							<span>{shot.script.length}/4000 字</span>
							<span className='ml-auto'>
								约 {Math.round(estimateScriptDuration(shot.script) / 1000)} 秒
							</span>
						</div>
						{drift && (
							<div className='rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200'>
								<p>
									{drift.direction === 'longer'
										? `将顺延后续画面约 ${drift.seconds} 秒`
										: `可缩短后续画面约 ${drift.seconds} 秒`}
								</p>
								<p className='mt-1 text-slate-400'>锚点保持不变，TTS 重算后自动对齐</p>
							</div>
						)}
						<button
							type='button'
							onClick={onGenerateNarration}
							disabled={!onGenerateNarration}
							className='flex w-full items-center justify-center gap-2 rounded-lg bg-pink-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-pink-400 disabled:opacity-50'
						>
							<LuBot /> AI 按页生成讲解稿
						</button>
						<label className='flex items-center gap-2 text-xs text-slate-400'>
							<input
								type='checkbox'
								checked={Boolean(scriptProtected)}
								onChange={(event) => onScriptProtectionChange?.(event.target.checked)}
								className='accent-pink-500'
							/>
							保护当前讲稿，AI 应用时跳过
						</label>
					</div>
				)}
				{activeTab === 'voice' && (
					<StoryboardVoicePanel
						ttsEndpoint={ttsEndpoint}
						text={shot.script}
						speed={speed}
						audioPreview={audioPreview}
						onSpeedChange={onSpeedChange}
						onAudioPreview={onAudioPreview}
					/>
				)}
				{activeTab === 'subtitles' && (
					<div className='space-y-4 p-4'>
						<label className='flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200'>
							<input
								type='checkbox'
								checked={shot.subtitlesEnabled ?? true}
								onChange={(event) => onSubtitlesEnabledChange(event.target.checked)}
								className='accent-pink-500'
							/>
							生成视频时显示底部字幕
						</label>
						<div className='relative aspect-video overflow-hidden rounded-xl border border-slate-700 bg-gradient-to-br from-slate-700 to-slate-950'>
							<div className='absolute inset-x-[8%] bottom-4 text-center text-sm leading-6 text-white'>
								<span className='rounded bg-black/65 px-2 py-1 [box-decoration-break:clone]'>
									{shot.script.trim() || '字幕预览文字'}
								</span>
							</div>
						</div>
						<p className='text-xs leading-5 text-slate-400'>
							字幕使用白色居中文字和半透明黑底，导出时同时生成 SRT 文件。
						</p>
					</div>
				)}
				{activeTab === 'animation' && (
					<div className='space-y-4 p-4'>
						<div className='rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-xs leading-5 text-slate-400'>
							将底部旁白片段拖到动画锚点，或在这里选择动画，控制讲稿从哪个动画节点开始播放。
						</div>
						<NarrationBindingEditor
							narrationClip={narrationClip}
							animationClips={animationClips ?? []}
							onChange={(binding) => onBindingChange?.(binding)}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}
