import type { PptxSlide } from 'pptx-viewer-core';
import React, { useState } from 'react';
import { LuAudioLines, LuBot, LuCaptions, LuLoaderCircle, LuVolume2 } from 'react-icons/lu';

import { slideDisplayTitle, slidePlainText } from './storyboard-model';
import type { StoryboardShot, StoryboardScriptRequest } from './storyboard-model';

interface StoryboardScriptPanelProps {
	shot: StoryboardShot;
	slide: PptxSlide;
	scriptEndpoint?: string;
	ttsEndpoint?: string;
	voiceType: number;
	speed: number;
	audioPreview?: { url: string; durationMs: number; taskId: string };
	onScriptChange: (script: string) => void;
	onVoiceTypeChange: (voiceType: number) => void;
	onSpeedChange: (speed: number) => void;
	onAudioPreview: (preview: { url: string; durationMs: number; taskId: string }) => void;
	onSubtitlesEnabledChange: (enabled: boolean) => void;
}

function localFallback(request: StoryboardScriptRequest): string {
	if (request.speakerNotes.trim()) {
		return request.speakerNotes.trim();
	}
	const content = request.slideText.replaceAll('\n', '，').slice(0, 260);
	return content
		? `现在请看${request.slideTitle}。这一部分主要讲解：${content}。请注意画面中的关键变化，我们按照当前分镜逐步理解。`
		: `现在进入${request.slideTitle}，请结合当前画面补充这一分镜的讲解内容。`;
}

export function StoryboardScriptPanel({
	shot,
	slide,
	scriptEndpoint,
	ttsEndpoint,
	voiceType,
	speed,
	audioPreview,
	onScriptChange,
	onVoiceTypeChange,
	onSpeedChange,
	onAudioPreview,
	onSubtitlesEnabledChange,
}: StoryboardScriptPanelProps): React.ReactElement {
	const [generating, setGenerating] = useState(false);
	const [notice, setNotice] = useState('');
	const [generatingAudio, setGeneratingAudio] = useState(false);
	const request: StoryboardScriptRequest = {
		shot,
		slideTitle: slideDisplayTitle(slide, shot.slideIndex),
		slideText: slidePlainText(slide),
		speakerNotes: slide.notes ?? '',
	};

	const generate = async () => {
		setGenerating(true);
		setNotice('');
		try {
			if (!scriptEndpoint) {
				throw new Error('missing endpoint');
			}
			const response = await fetch(scriptEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request),
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const payload = (await response.json()) as { script?: string };
			if (!payload.script?.trim()) {
				throw new Error('empty script');
			}
			onScriptChange(payload.script.trim());
			setNotice('DeepSeek 已生成当前分镜讲稿');
		} catch {
			onScriptChange(localFallback(request));
			setNotice('DeepSeek 尚未配置，已生成本地演示稿');
		} finally {
			setGenerating(false);
		}
	};

	const generateAudio = async () => {
		if (!ttsEndpoint || !shot.script.trim()) {
			return;
		}
		setGeneratingAudio(true);
		setNotice('');
		try {
			const response = await fetch(ttsEndpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: shot.script, voiceType, speed }),
			});
			const payload = (await response.json()) as {
				error?: string;
				provider?: string;
				taskId?: string;
				durationMs?: number;
				audioBase64?: string;
			};
			if (!response.ok || !payload.audioBase64 || !payload.taskId) {
				throw new Error(payload.error || `HTTP ${response.status}`);
			}
			const preview = {
				url: `data:audio/wav;base64,${payload.audioBase64}`,
				durationMs: payload.durationMs ?? 0,
				taskId: payload.taskId,
			};
			onAudioPreview(preview);
			setNotice(
				`${payload.provider === 'edge-tts' ? '晓晓神经语音' : payload.provider === 'local-espeak' ? '本地普通话配音' : '腾讯精品 TTS'}已生成 · ${preview.taskId}`,
			);
			await new Audio(preview.url).play();
		} catch (error) {
			setNotice(error instanceof Error ? `配音失败：${error.message}` : '配音失败');
		} finally {
			setGeneratingAudio(false);
		}
	};

	return (
		<aside className='flex w-[360px] shrink-0 flex-col border-l border-slate-200 bg-white'>
			<div className='flex items-center border-b border-slate-200 px-5 py-4'>
				<div>
					<h2 className='text-lg font-bold text-slate-900'>分镜讲稿</h2>
					<p className='mt-0.5 text-xs text-slate-500'>
						{shot.label} · {shot.effectLabel}
					</p>
				</div>
				<span className='ml-auto rounded-full bg-orange-50 px-2 py-1 text-[11px] font-medium text-orange-600'>
					DeepSeek
				</span>
			</div>
			<div className='flex flex-1 flex-col gap-4 overflow-y-auto p-5'>
				<div className='flex rounded-lg bg-slate-100 p-1 text-sm'>
					<button
						type='button'
						className='flex-1 rounded-md bg-white px-3 py-2 font-semibold text-slate-900 shadow-sm'
					>
						文本
					</button>
					<button type='button' disabled className='flex-1 px-3 py-2 text-slate-400'>
						字幕样式（即将支持）
					</button>
				</div>
				<textarea
					value={shot.script}
					maxLength={4000}
					onChange={(event) => onScriptChange(event.target.value)}
					placeholder='输入当前分镜的配音讲稿...'
					className='min-h-[260px] w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100'
				/>
				<div className='flex items-center text-xs text-slate-400'>
					<span>{shot.script.length}/4000 字</span>
					<span className='ml-auto'>约 {Math.max(1, Math.round(shot.script.length / 4.2))} 秒</span>
				</div>
				<button
					type='button'
					onClick={() => void generate()}
					disabled={generating}
					className='flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60'
				>
					{generating ? (
						<LuLoaderCircle className='h-4 w-4 animate-spin' />
					) : (
						<LuBot className='h-4 w-4' />
					)}
					{generating ? '正在生成...' : 'DeepSeek 生成讲稿'}
				</button>
				{notice && (
					<p className='rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700'>{notice}</p>
				)}
				<div className='rounded-xl border border-slate-200 p-4'>
					<div className='mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800'>
						<LuAudioLines /> 配音
					</div>
					<div className='flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600'>
						<LuVolume2 className='text-orange-500' />
						<select
							value={voiceType}
							onChange={(event) => onVoiceTypeChange(Number(event.target.value))}
							className='min-w-0 flex-1 bg-transparent outline-none'
						>
							<option value={101001}>智瑜 · 精品女声</option>
							<option value={101054}>智友 · 精品音色</option>
							<option value={101030}>智柯 · 精品音色</option>
							<option value={101055}>智付 · 精品音色</option>
							<option value={101027}>智梅 · 精品音色</option>
						</select>
						<button
							type='button'
							onClick={() => audioPreview && void new Audio(audioPreview.url).play()}
							disabled={!audioPreview}
							className='ml-auto text-xs text-orange-600 disabled:text-slate-300'
						>
							播放
						</button>
					</div>
					<label className='mt-3 flex items-center gap-2 text-xs text-slate-500'>
						语速
						<input
							type='range'
							min={-2}
							max={3}
							step={0.5}
							value={speed}
							onChange={(event) => onSpeedChange(Number(event.target.value))}
							className='flex-1 accent-orange-500'
						/>
						<span>
							{speed > 0 ? '+' : ''}
							{speed}
						</span>
					</label>
					<button
						type='button'
						onClick={() => void generateAudio()}
						disabled={generatingAudio || !ttsEndpoint || !shot.script.trim()}
						className='mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50'
					>
						{generatingAudio ? (
							<LuLoaderCircle className='h-4 w-4 animate-spin' />
						) : (
							<LuAudioLines className='h-4 w-4' />
						)}
						{generatingAudio ? '生成配音中...' : '生成并试听'}
					</button>
					<label className='mt-3 flex items-center gap-2 text-sm text-slate-600'>
						<LuCaptions />{' '}
						<input
							type='checkbox'
							checked={shot.subtitlesEnabled ?? true}
							onChange={(event) => onSubtitlesEnabledChange(event.target.checked)}
							className='accent-orange-500'
						/>{' '}
						生成字幕
					</label>
				</div>
			</div>
		</aside>
	);
}
