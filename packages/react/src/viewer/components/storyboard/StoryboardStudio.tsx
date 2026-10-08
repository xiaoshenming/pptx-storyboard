import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CanvasSize, StoryboardAutoGenerateOptions } from '../../types';
import { polishStoryboardForVideo } from './auto-polish-narration';
import { MultiTrackTimeline } from './MultiTrackTimeline';
import {
	animationClipsOf,
	createTargetLabelResolver,
	narrationClipForShot,
} from './playback-model';
import {
	captureGenerationProgress,
	polishGenerationProgress,
	serverGenerationProgress,
} from './storyboard-generation-progress';
import { formatStoryboardTime, storyboardSlideForShot } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';
import { loadStoryboardProject, storyboardProjectId } from './storyboard-project-store';
import { buildStoryboardTimeline } from './storyboard-timeline-adapter';
import {
	restoreStoryboardTimeline,
	hasInvalidStoryboardTiming,
} from './storyboard-timing-recovery';
import { StoryboardJobStatus } from './StoryboardJobStatus';
import { StoryboardPageRail } from './StoryboardPageRail';
import { StoryboardPreview } from './StoryboardPreview';
import { StoryboardScriptPanel } from './StoryboardScriptPanel';
import { StoryboardStudioHeader } from './StoryboardStudioHeader';
import { StoryboardStudioLayout } from './StoryboardStudioLayout';
import type { TimelineModel } from './timeline';
import { useStoryboardAutosave } from './use-storyboard-autosave';
import { isStoryboardJobActive } from './use-storyboard-job-recovery';
import {
	useStoryboardPlayback,
	useStoryboardPlaybackKeys,
	useStoryboardPlaybackSelection,
} from './use-storyboard-playback';
import { useStoryboardShots } from './use-storyboard-shots';
import { useStoryboardTimelineEdits } from './use-storyboard-timeline-edits';
import { useStoryboardVideoJob } from './use-storyboard-video-job';
import { useStudioNarration } from './use-studio-narration';

interface StoryboardStudioProps {
	projectKey?: string;
	fileName?: string;
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	scriptEndpoint?: string;
	ttsEndpoint?: string;
	jobEndpoint?: string;
	autoGenerate?: boolean;
	autoGenerateOptions?: StoryboardAutoGenerateOptions;
	onGenerationProgress?: (progress: {
		stage: string;
		progress: number;
		status: string;
		jobId?: string;
		terminal?: boolean;
	}) => void;
	onClose: () => void;
}

export function StoryboardStudio({
	projectKey,
	fileName,
	slides,
	templateElementsBySlideId,
	canvasSize,
	scriptEndpoint,
	ttsEndpoint,
	jobEndpoint,
	autoGenerate = false,
	autoGenerateOptions,
	onGenerationProgress,
	onClose,
}: StoryboardStudioProps): React.ReactElement {
	const generatedShots = useStoryboardShots(slides);
	const projectId = useMemo(
		() => storyboardProjectId(projectKey ?? (fileName || 'presentation.pptx'), generatedShots),
		[fileName, generatedShots, projectKey],
	);
	const restored = useMemo(() => loadStoryboardProject(projectId), [projectId]);
	// Target labels resolve once per slides/template change; the restore effect
	// reads them through a ref so a new lookup alone never rebuilds the timeline.
	const resolveTargetLabel = useMemo(
		() =>
			createTargetLabelResolver([
				...slides.map((slide) => slide.elements),
				...Object.values(templateElementsBySlideId),
			]),
		[slides, templateElementsBySlideId],
	);
	const labelResolverRef = useRef(resolveTargetLabel);
	labelResolverRef.current = resolveTargetLabel;
	const [shots, setShots] = useState<StoryboardShot[]>(restored?.shots ?? generatedShots);
	const [timeline, setTimeline] = useState<TimelineModel>(() =>
		restored
			? restoreStoryboardTimeline(restored, generatedShots)
			: buildStoryboardTimeline(generatedShots, { resolveTargetLabel }),
	);
	const [selectedShotId, setSelectedShotId] = useState(generatedShots[0]?.id ?? '');
	const [selectedClipId, setSelectedClipId] = useState<string | undefined>(undefined);
	const initialExportStatus =
		restored && hasInvalidStoryboardTiming(restored.timeline)
			? '检测到异常时间轴，已尝试备份并重建时序；讲稿保留，手动时间位置恢复默认。'
			: '';
	const [voiceType, setVoiceType] = useState(101001);
	const [voiceSpeed, setVoiceSpeed] = useState(0);
	const [audioPreviews, setAudioPreviews] = useState<
		Record<string, { url: string; durationMs: number; taskId: string }>
	>({});
	const video = useStoryboardVideoJob({
		endpoint: jobEndpoint,
		fileName,
		shots:
			autoGenerate && typeof autoGenerateOptions?.subtitlesEnabled === 'boolean'
				? shots.map((shot) => ({ ...shot, subtitlesEnabled: autoGenerateOptions.subtitlesEnabled }))
				: shots,
		slides,
		templateElementsBySlideId,
		canvasSize,
		timeline,
		voiceType,
		speed: voiceSpeed,
		initialJob: restored?.lastJob,
		initialStatus: initialExportStatus,
	});
	const setRenderJob = video.setJob;
	const autoGenerateStarted = useRef(false);
	const [autoGeneratePhase, setAutoGeneratePhase] = useState<
		'idle' | 'polishing' | 'ready' | 'started'
	>('idle');
	const autoGenerateFailed = useRef(false);
	const generationProgressCallbackRef = useRef(onGenerationProgress);
	generationProgressCallbackRef.current = onGenerationProgress;
	const lastGenerationProgress = useRef(0);
	const lastGenerationPayload = useRef('');
	const reportGenerationProgress = useCallback(
		(progress: {
			stage: string;
			progress: number;
			status: string;
			jobId?: string;
			terminal?: boolean;
		}) => {
			const mapped = {
				...progress,
				progress: Math.max(
					lastGenerationProgress.current,
					Math.max(0, Math.min(100, Math.round(progress.progress))),
				),
			};
			lastGenerationProgress.current = mapped.progress;
			const signature = JSON.stringify(mapped);
			if (signature === lastGenerationPayload.current) {
				return;
			}
			lastGenerationPayload.current = signature;
			generationProgressCallbackRef.current?.(mapped);
		},
		[],
	);

	const handleActiveShotChange = (shotId: string) => {
		setSelectedShotId(shotId);
		setSelectedClipId(undefined);
	};
	const playback = useStoryboardPlayback({ timeline, onActiveShotChange: handleActiveShotChange });
	const playbackRef = useRef(playback);
	playbackRef.current = playback;
	useStoryboardPlaybackKeys(playback, timeline);
	const { playheadMs, isPlaying, seek, togglePlay, stop } = playback;
	const { selectShot, selectClip, playAll } = useStoryboardPlaybackSelection({
		timeline,
		controller: playback,
		onShotSelected: setSelectedShotId,
		onClipSelected: setSelectedClipId,
	});
	const {
		applyTimelineEdit,
		applyNarrationPreview,
		changeNarrationBinding,
		updateShot,
		updateShots,
	} = useStoryboardTimelineEdits({
		timeline,
		selectedShotId,
		generatedShots,
		setTimeline,
		setShots,
	});

	useEffect(() => {
		const saved = loadStoryboardProject(projectId);
		const compatible =
			saved?.shots.map((shot) => shot.id).join('|') ===
			generatedShots.map((shot) => shot.id).join('|');
		setShots(compatible && saved ? saved.shots : generatedShots);
		setSelectedShotId((current) =>
			generatedShots.some((shot) => shot.id === current) ? current : (generatedShots[0]?.id ?? ''),
		);
		setTimeline(
			compatible && saved
				? restoreStoryboardTimeline(saved, generatedShots)
				: buildStoryboardTimeline(generatedShots, { resolveTargetLabel: labelResolverRef.current }),
		);
		setRenderJob(compatible && saved ? (saved.lastJob ?? null) : null);
		playbackRef.current.stop();
		playbackRef.current.seek(0);
	}, [generatedShots, projectId, setRenderJob]);
	const { saveStatus, flush, getBindingRevision } = useStoryboardAutosave({
		projectId,
		fileName: fileName || 'presentation.pptx',
		shots,
		timeline,
		lastJob: video.job,
	});
	useEffect(() => {
		if (!generationProgressCallbackRef.current) {
			return;
		}
		if (autoGenerate && (autoGeneratePhase !== 'started' || autoGenerateFailed.current)) {
			return;
		}
		if (video.job) {
			const isTerminalStage = ['completed', 'failed', 'cancelled'].includes(video.job.stage);
			reportGenerationProgress({
				stage: video.job.stage,
				progress: serverGenerationProgress(video.job.progress),
				status: video.status,
				jobId: video.job.id,
				terminal: isTerminalStage && !video.exporting,
			});
			return;
		}
		const capture = video.status.match(/并行捕获分镜\s+(\d+)\/(\d+)/u);
		const progress = capture
			? captureGenerationProgress(Number(capture[1]), Number(capture[2]))
			: video.exporting
				? 45
				: 0;
		const failed = autoGenerateStarted.current && !video.exporting && Boolean(video.status);
		reportGenerationProgress({
			stage: failed ? 'failed' : capture ? 'capturing' : video.exporting ? 'preparing' : 'idle',
			progress,
			status: video.status || (video.exporting ? '正在准备分镜' : ''),
			terminal: failed,
		});
	}, [
		autoGenerate,
		autoGeneratePhase,
		reportGenerationProgress,
		video.exporting,
		video.job,
		video.status,
	]);
	useEffect(() => {
		if (!autoGenerate || autoGeneratePhase !== 'idle' || shots.length === 0) {
			return;
		}
		if (autoGenerateOptions?.polish === false) {
			reportGenerationProgress({
				stage: 'preparing',
				progress: 45,
				status: '跳过 AI 润色，正在准备分镜',
			});
			setAutoGeneratePhase('ready');
			return;
		}
		if (!scriptEndpoint) {
			autoGenerateFailed.current = true;
			setAutoGeneratePhase('started');
			reportGenerationProgress({
				stage: 'failed',
				progress: 0,
				status: '未配置讲稿生成接口',
				terminal: true,
			});
			return;
		}
		setAutoGeneratePhase('polishing');
		void polishStoryboardForVideo({
			endpoint: scriptEndpoint.replace(/\/generate\/?$/, '/narration'),
			slides,
			shots,
			generated: generatedShots,
			narrationOptions: autoGenerateOptions,
			onProgress: (done, total) =>
				reportGenerationProgress({
					stage: 'polishing',
					progress: polishGenerationProgress(done, total),
					status: `AI 润色讲稿 ${done}/${total}`,
				}),
		})
			.then((patches) => {
				updateShots(patches);
				setAutoGeneratePhase('ready');
				return undefined;
			})
			.catch((error) => {
				autoGenerateFailed.current = true;
				setAutoGeneratePhase('started');
				reportGenerationProgress({
					stage: 'failed',
					progress: 0,
					status: error instanceof Error ? error.message : 'AI 讲稿润色失败',
					terminal: true,
				});
			});
	}, [
		autoGenerate,
		autoGenerateOptions,
		autoGeneratePhase,
		generatedShots,
		reportGenerationProgress,
		scriptEndpoint,
		shots,
		slides,
		updateShots,
	]);
	useEffect(() => {
		if (
			!autoGenerate ||
			autoGeneratePhase !== 'ready' ||
			autoGenerateStarted.current ||
			!jobEndpoint
		) {
			return;
		}
		autoGenerateStarted.current = true;
		setAutoGeneratePhase('started');
		stop();
		const flushed = flush();
		void video.generate(flushed?.bindingRevision ?? getBindingRevision());
	}, [autoGenerate, autoGeneratePhase, flush, getBindingRevision, jobEndpoint, stop, video]);

	const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
	const narration = useStudioNarration({
		scriptEndpoint,
		slides,
		shots,
		generated: generatedShots,
		selected: selectedShot,
		updateShot,
		updateShots,
		setAudioPreviews,
	});
	const narrationClip = selectedShot ? narrationClipForShot(timeline, selectedShot.id) : undefined;
	const sourceSlide = selectedShot ? slides[selectedShot.slideIndex] : slides[0];
	const selectedSlide =
		selectedShot && sourceSlide ? storyboardSlideForShot(sourceSlide, selectedShot) : sourceSlide;

	return (
		<div className='fixed inset-0 z-[300] flex flex-col bg-[#101117] text-slate-100'>
			{narration.dialog}
			<StoryboardStudioHeader
				fileName={fileName}
				projectId={projectId}
				pageCount={slides.length}
				shotCount={shots.length}
				durationLabel={formatStoryboardTime(timeline.durationMs)}
				saveStatus={saveStatus}
				exportStatus={video.status}
				exporting={video.exporting}
				jobStatus={
					video.job ? (
						<StoryboardJobStatus
							job={video.job}
							onCancel={isStoryboardJobActive(video.job) ? () => void video.cancel() : undefined}
						/>
					) : undefined
				}
				canGenerate={Boolean(jobEndpoint)}
				canCancel={isStoryboardJobActive(video.job)}
				onClose={onClose}
				onGenerate={() => {
					stop();
					const flushed = flush();
					void video.generate(flushed?.bindingRevision ?? getBindingRevision());
				}}
				onCancel={() => void video.cancel()}
			/>

			<StoryboardStudioLayout
				workspace={
					<>
						<StoryboardPageRail
							slides={slides}
							shots={shots}
							selectedShot={selectedShot}
							templateElementsBySlideId={templateElementsBySlideId}
							canvasSize={canvasSize}
							onSelectShot={selectShot}
						/>
						{selectedSlide && selectedShot && (
							<StoryboardPreview
								slide={selectedSlide}
								templateElements={templateElementsBySlideId[selectedSlide.id] ?? []}
								canvasSize={canvasSize}
								isPlaying={isPlaying}
								onTogglePlay={togglePlay}
								onRestart={() => {
									seek(0);
									if (!isPlaying) {
										togglePlay();
									}
								}}
								progressMs={playheadMs}
								durationMs={timeline.durationMs}
								subtitleText={
									selectedShot.subtitlesEnabled === false ? undefined : selectedShot.script
								}
							/>
						)}
						{sourceSlide && selectedShot && (
							<StoryboardScriptPanel
								shot={selectedShot}
								slide={sourceSlide}
								onGenerateNarration={() => {
									stop();
									narration.open();
								}}
								scriptProtected={narration.scriptProtected}
								onScriptProtectionChange={(scriptLocked) =>
									updateShot(selectedShot.id, { scriptLocked })
								}
								ttsEndpoint={ttsEndpoint}
								voiceType={voiceType}
								speed={voiceSpeed}
								audioPreview={audioPreviews[selectedShot.id]}
								narrationClip={narrationClip}
								animationClips={animationClipsOf(timeline)}
								onBindingChange={changeNarrationBinding}
								onVoiceTypeChange={(value) => {
									setVoiceType(value);
									setAudioPreviews({});
								}}
								onSpeedChange={(value) => {
									setVoiceSpeed(value);
									setAudioPreviews({});
								}}
								onScriptChange={narration.changeScript}
								onSubtitlesEnabledChange={(enabled) =>
									updateShot(selectedShot.id, { subtitlesEnabled: enabled })
								}
								onAudioPreview={(preview) => {
									setAudioPreviews((current) => ({ ...current, [selectedShot.id]: preview }));
									applyNarrationPreview(selectedShot.id, preview.durationMs);
								}}
							/>
						)}
					</>
				}
				timeline={
					<MultiTrackTimeline
						timeline={timeline}
						selectedSourceId={selectedShot?.id}
						selectedClipId={selectedClipId}
						playheadMs={playheadMs}
						editingNarrationClipId={narrationClip?.id}
						onChange={applyTimelineEdit}
						onSelectSource={selectShot}
						onSelectClip={selectClip}
						onSeek={seek}
						onPlayAll={() => playAll(shots[0]?.id ?? '')}
						height='100%'
					/>
				}
			/>
		</div>
	);
}
