import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { CanvasSize } from '../../types';
import { MultiTrackTimeline } from './MultiTrackTimeline';
import {
	animationClipsOf,
	createTargetLabelResolver,
	narrationClipForShot,
} from './playback-model';
import { runStoryboardExport } from './storyboard-export-workflow';
import { cancelStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';
import { formatStoryboardTime, storyboardSlideForShot } from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';
import { loadStoryboardProject, storyboardProjectId } from './storyboard-project-store';
import {
	buildStoryboardTimeline,
	normalizeNarrationDurations,
} from './storyboard-timeline-adapter';
import { StoryboardJobStatus } from './StoryboardJobStatus';
import { StoryboardPageRail } from './StoryboardPageRail';
import { StoryboardPreview } from './StoryboardPreview';
import { StoryboardScriptPanel } from './StoryboardScriptPanel';
import { StoryboardStudioHeader } from './StoryboardStudioHeader';
import type { TimelineModel } from './timeline';
import { useStoryboardAutosave } from './use-storyboard-autosave';
import { isStoryboardJobActive, useStoryboardJobRecovery } from './use-storyboard-job-recovery';
import {
	useStoryboardPlayback,
	useStoryboardPlaybackKeys,
	useStoryboardPlaybackSelection,
} from './use-storyboard-playback';
import { useStoryboardShots } from './use-storyboard-shots';
import { useStoryboardTimelineEdits } from './use-storyboard-timeline-edits';

interface StoryboardStudioProps {
	fileName?: string;
	slides: PptxSlide[];
	templateElementsBySlideId: Record<string, PptxElement[]>;
	canvasSize: CanvasSize;
	scriptEndpoint?: string;
	ttsEndpoint?: string;
	jobEndpoint?: string;
	onClose: () => void;
}

export function StoryboardStudio({
	fileName,
	slides,
	templateElementsBySlideId,
	canvasSize,
	scriptEndpoint,
	ttsEndpoint,
	jobEndpoint,
	onClose,
}: StoryboardStudioProps): React.ReactElement {
	const generatedShots = useStoryboardShots(slides);
	const projectId = useMemo(
		() => storyboardProjectId(fileName || 'presentation.pptx', generatedShots),
		[fileName, generatedShots],
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
			? normalizeNarrationDurations(restored.timeline, restored.shots)
			: buildStoryboardTimeline(generatedShots, { resolveTargetLabel }),
	);
	const [selectedShotId, setSelectedShotId] = useState(generatedShots[0]?.id ?? '');
	const [selectedClipId, setSelectedClipId] = useState<string | undefined>(undefined);
	const [exporting, setExporting] = useState(false);
	const [exportStatus, setExportStatus] = useState('');
	const disposedRef = useRef(false);
	useEffect(() => () => void (disposedRef.current = true), []);
	const [renderJob, setRenderJob] = useState<StoryboardJobProgress | null>(
		restored?.lastJob ?? null,
	);
	const [voiceType, setVoiceType] = useState(101001);
	const [voiceSpeed, setVoiceSpeed] = useState(0);
	const [audioPreviews, setAudioPreviews] = useState<
		Record<string, { url: string; durationMs: number; taskId: string }>
	>({});
	useStoryboardJobRecovery(jobEndpoint, renderJob, setRenderJob);

	// The playhead owns time: selection follows it, so this callback never
	// seeks, or the auto shot advance during playback would loop.
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
	const { applyTimelineEdit, applyNarrationPreview, changeNarrationBinding, updateShot } =
		useStoryboardTimelineEdits({
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
				? normalizeNarrationDurations(saved.timeline, saved.shots)
				: buildStoryboardTimeline(generatedShots, { resolveTargetLabel: labelResolverRef.current }),
		);
		setRenderJob(compatible && saved ? (saved.lastJob ?? null) : null);
		playbackRef.current.stop();
		playbackRef.current.seek(0);
	}, [generatedShots, projectId]);
	const { saveStatus, flush, getBindingRevision } = useStoryboardAutosave({
		projectId,
		fileName: fileName || 'presentation.pptx',
		shots,
		timeline,
		lastJob: renderJob,
	});

	const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
	const sourceSlide = selectedShot ? slides[selectedShot.slideIndex] : slides[0];
	const selectedSlide =
		selectedShot && sourceSlide ? storyboardSlideForShot(sourceSlide, selectedShot) : sourceSlide;

	const generateVideo = async () => {
		if (!selectedShot || exporting || !jobEndpoint) {
			return;
		}
		stop();
		setExporting(true);
		try {
			const flushed = flush(); // 冲刷防抖窗口：revision 回执与导出的绑定模型同批。
			await runStoryboardExport({
				endpoint: jobEndpoint,
				fileName: fileName || 'presentation.pptx',
				shots,
				slides,
				templateElementsBySlideId,
				canvasSize,
				voiceType,
				speed: voiceSpeed,
				timeline,
				bindingRevision: flushed?.bindingRevision ?? getBindingRevision(),
				isDisposed: () => disposedRef.current,
				onJob: setRenderJob,
				onStatus: setExportStatus,
			});
		} catch (error) {
			setExportStatus(error instanceof Error ? error.message : '视频生成失败');
		} finally {
			setExporting(false);
		}
	};
	const cancelVideo = async () => {
		if (!jobEndpoint || !renderJob || !renderJob.jobToken) {
			return;
		}
		await cancelStoryboardRenderJob(jobEndpoint, renderJob.id, renderJob.jobToken);
		setExportStatus(`正在取消任务 ${renderJob.id.slice(0, 8)}`);
	};

	return (
		<div className='fixed inset-0 z-[300] flex flex-col bg-[#f4f5f8] text-slate-900'>
			{renderJob && (
				<StoryboardJobStatus
					job={renderJob}
					onCancel={isStoryboardJobActive(renderJob) ? cancelVideo : undefined}
				/>
			)}
			<StoryboardStudioHeader
				fileName={fileName}
				projectId={projectId}
				pageCount={slides.length}
				shotCount={shots.length}
				durationLabel={formatStoryboardTime(timeline.durationMs)}
				saveStatus={saveStatus}
				exportStatus={exportStatus}
				exporting={exporting}
				canGenerate={Boolean(jobEndpoint)}
				canCancel={isStoryboardJobActive(renderJob)}
				onClose={onClose}
				onGenerate={() => void generateVideo()}
				onCancel={() => void cancelVideo()}
			/>

			<div className='flex min-h-0 flex-1'>
				<StoryboardPageRail
					slides={slides}
					shots={shots}
					selectedShot={selectedShot}
					templateElementsBySlideId={templateElementsBySlideId}
					canvasSize={canvasSize}
					onSelectShot={selectShot}
				/>

				<div className='flex min-w-0 flex-1 flex-col'>
					<div className='flex min-h-0 flex-1'>
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
							/>
						)}
						{sourceSlide && selectedShot && (
							<StoryboardScriptPanel
								shot={selectedShot}
								slide={sourceSlide}
								scriptEndpoint={scriptEndpoint}
								ttsEndpoint={ttsEndpoint}
								voiceType={voiceType}
								speed={voiceSpeed}
								audioPreview={audioPreviews[selectedShot.id]}
								narrationClip={narrationClipForShot(timeline, selectedShot.id)}
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
								onScriptChange={(script) => {
									updateShot(selectedShot.id, { script });
									setAudioPreviews((current) => {
										const next = { ...current };
										delete next[selectedShot.id];
										return next;
									});
								}}
								onSubtitlesEnabledChange={(enabled) =>
									updateShot(selectedShot.id, { subtitlesEnabled: enabled })
								}
								onAudioPreview={(preview) => {
									setAudioPreviews((current) => ({ ...current, [selectedShot.id]: preview }));
									applyNarrationPreview(selectedShot.id, preview.durationMs);
								}}
							/>
						)}
					</div>
					<MultiTrackTimeline
						timeline={timeline}
						selectedSourceId={selectedShot?.id}
						selectedClipId={selectedClipId}
						playheadMs={playheadMs}
						onChange={applyTimelineEdit}
						onSelectSource={selectShot}
						onSelectClip={selectClip}
						onSeek={seek}
						onPlayAll={() => playAll(shots[0]?.id ?? '')}
					/>
				</div>
			</div>
		</div>
	);
}
