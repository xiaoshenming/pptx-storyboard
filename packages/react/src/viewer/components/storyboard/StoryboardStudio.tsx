import type { PptxElement, PptxSlide } from 'pptx-viewer-core';
import React, { useEffect, useMemo, useState } from 'react';

import type { CanvasSize } from '../../types';
import { MultiTrackTimeline } from './MultiTrackTimeline';
import { runStoryboardExport } from './storyboard-export-workflow';
import { cancelStoryboardRenderJob } from './storyboard-job-client';
import type { StoryboardJobProgress } from './storyboard-job-client';
import {
	buildStoryboardShots,
	formatStoryboardTime,
	storyboardSlideForShot,
} from './storyboard-model';
import type { StoryboardShot } from './storyboard-model';
import { loadStoryboardProject, storyboardProjectId } from './storyboard-project-store';
import {
	applyNarrationDuration,
	buildStoryboardTimeline,
	normalizeNarrationDurations,
	reconcileNarrationTiming,
	updateTimelineScript,
} from './storyboard-timeline-adapter';
import { StoryboardExportStages } from './StoryboardExportStages';
import { StoryboardJobStatus } from './StoryboardJobStatus';
import { StoryboardPageRail } from './StoryboardPageRail';
import { StoryboardPreview } from './StoryboardPreview';
import { StoryboardScriptPanel } from './StoryboardScriptPanel';
import { StoryboardStudioHeader } from './StoryboardStudioHeader';
import type { TimelineModel } from './timeline';
import { estimateScriptDuration } from './timeline';
import { useStoryboardAutosave } from './use-storyboard-autosave';
import { isStoryboardJobActive, useStoryboardJobRecovery } from './use-storyboard-job-recovery';
import { useStoryboardPlayback } from './use-storyboard-playback';

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
	const generatedShots = useMemo(() => buildStoryboardShots(slides), [slides]);
	const projectId = useMemo(
		() => storyboardProjectId(fileName || 'presentation.pptx', generatedShots),
		[fileName, generatedShots],
	);
	const restored = useMemo(() => loadStoryboardProject(projectId), [projectId]);
	const [shots, setShots] = useState<StoryboardShot[]>(restored?.shots ?? generatedShots);
	const [timeline, setTimeline] = useState<TimelineModel>(() =>
		restored
			? normalizeNarrationDurations(restored.timeline, restored.shots)
			: buildStoryboardTimeline(generatedShots),
	);
	const [selectedShotId, setSelectedShotId] = useState(generatedShots[0]?.id ?? '');
	const [isPlaying, setIsPlaying] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportStatus, setExportStatus] = useState('');
	const [renderJob, setRenderJob] = useState<StoryboardJobProgress | null>(
		restored?.lastJob ?? null,
	);
	const [voiceType, setVoiceType] = useState(101001);
	const [voiceSpeed, setVoiceSpeed] = useState(0);
	const [audioPreviews, setAudioPreviews] = useState<
		Record<string, { url: string; durationMs: number; taskId: string }>
	>({});
	useStoryboardJobRecovery(jobEndpoint, renderJob, setRenderJob);

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
				: buildStoryboardTimeline(generatedShots),
		);
		setRenderJob(compatible && saved ? (saved.lastJob ?? null) : null);
	}, [generatedShots, projectId]);
	const saveStatus = useStoryboardAutosave({
		projectId,
		fileName: fileName || 'presentation.pptx',
		shots,
		timeline,
		lastJob: renderJob,
	});
	useStoryboardPlayback(
		isPlaying,
		selectedShotId,
		shots,
		timeline,
		setSelectedShotId,
		setIsPlaying,
	);

	const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0];
	const sourceSlide = selectedShot ? slides[selectedShot.slideIndex] : slides[0];
	const selectedSlide =
		selectedShot && sourceSlide ? storyboardSlideForShot(sourceSlide, selectedShot) : sourceSlide;

	const updateShot = (shotId: string, patch: Partial<StoryboardShot>) => {
		const baseDuration = generatedShots.find((shot) => shot.id === shotId)?.durationMs ?? 0;
		const estimatedDuration =
			typeof patch.script === 'string'
				? Math.max(baseDuration, estimateScriptDuration(patch.script) + 250)
				: undefined;
		setShots((current) =>
			current.map((shot) =>
				shot.id === shotId
					? {
							...shot,
							...patch,
							durationMs: estimatedDuration ?? shot.durationMs,
						}
					: shot,
			),
		);
		if (typeof patch.script === 'string') {
			setTimeline((current) =>
				applyNarrationDuration(
					updateTimelineScript(current, shotId, patch.script!),
					shotId,
					estimatedDuration!,
				),
			);
		}
	};
	const handleTimelineChange = (next: TimelineModel) => {
		const reconciled = reconcileNarrationTiming(next);
		setTimeline(reconciled);
		const visual = reconciled.tracks.find((track) => track.kind === 'visual');
		if (!visual) {
			return;
		}
		setShots((current) =>
			current.map((shot) => {
				const clip = visual.clips.find((item) => item.sourceId === shot.id);
				return clip ? { ...shot, durationMs: clip.durationMs } : shot;
			}),
		);
	};
	const generateVideo = async () => {
		if (!selectedShot || exporting || !jobEndpoint) {
			return;
		}
		setIsPlaying(false);
		setExporting(true);
		try {
			await runStoryboardExport({
				endpoint: jobEndpoint,
				fileName: fileName || 'presentation.pptx',
				shots,
				voiceType,
				speed: voiceSpeed,
				timeline,
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
		if (!jobEndpoint || !renderJob) {
			return;
		}
		if (!renderJob.jobToken) {
			return;
		}
		await cancelStoryboardRenderJob(jobEndpoint, renderJob.id, renderJob.jobToken);
		setExportStatus(`正在取消任务 ${renderJob.id.slice(0, 8)}`);
	};

	return (
		<div className='fixed inset-0 z-[300] flex flex-col bg-[#f4f5f8] text-slate-900'>
			<StoryboardExportStages
				shots={shots}
				slides={slides}
				templateElementsBySlideId={templateElementsBySlideId}
				canvasSize={canvasSize}
			/>
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
					onSelectShot={setSelectedShotId}
				/>

				<div className='flex min-w-0 flex-1 flex-col'>
					<div className='flex min-h-0 flex-1'>
						{selectedSlide && selectedShot && (
							<StoryboardPreview
								slide={selectedSlide}
								templateElements={templateElementsBySlideId[selectedSlide.id] ?? []}
								canvasSize={canvasSize}
								isPlaying={isPlaying}
								onTogglePlay={() => setIsPlaying((value) => !value)}
								onRestart={() => {
									setSelectedShotId(shots[0]?.id ?? '');
									setIsPlaying(true);
								}}
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
									setTimeline((current) =>
										applyNarrationDuration(current, selectedShot.id, preview.durationMs),
									);
								}}
							/>
						)}
					</div>
					<MultiTrackTimeline
						timeline={timeline}
						selectedSourceId={selectedShot?.id}
						onChange={handleTimelineChange}
						onSelectSource={setSelectedShotId}
						onPlayAll={() => {
							setSelectedShotId(shots[0]?.id ?? '');
							setIsPlaying(true);
						}}
					/>
				</div>
			</div>
		</div>
	);
}
