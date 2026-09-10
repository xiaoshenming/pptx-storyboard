import { useCallback, useEffect, useRef, useState } from 'react';

import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import {
	diffStoryboardBindings,
	loadStoryboardProject,
	recordBindingEvents,
	saveStoryboardProject,
} from './storyboard-project-store';
import type { StoryboardProjectSnapshot } from './storyboard-project-store';
import type { TimelineModel } from './timeline';

interface AutosaveInput {
	projectId: string;
	fileName: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	lastJob: StoryboardJobProgress | null;
}

/** Header save indicator: debounced write in flight, written, or write failed. */
export type StoryboardSaveStatus = 'saving' | 'saved' | 'error';

export interface StoryboardAutosaveHandle {
	/** Header indicator: a save is debounced, written, or failed (quota, ...). */
	saveStatus: StoryboardSaveStatus;
	/**
	 * 同步立即落盘一次并返回写入的快照；组件卸载后返回 null；写失败（如配额
	 * 满）同样返回 null 并把 saveStatus 置为 'error'。导出前调用，保证
	 * manifest 回执里的 bindingRevision 与导出的绑定模型同批。
	 */
	flush: () => StoryboardProjectSnapshot | null;
	/** 有效绑定修订号：已落盘批次号 + 尚未落盘的绑定变更所属批次。 */
	getBindingRevision: () => number;
}

/** Debounce window; consecutive edits keep re-arming the pending save. */
const AUTOSAVE_DELAY_MS = 300;

interface AutosaveBaseline {
	revision: number;
	persistedTimeline?: TimelineModel;
}

/** Restore the in-memory baseline from the stored snapshot of one project. */
function readBaseline(projectId: string): AutosaveBaseline {
	const stored = loadStoryboardProject(projectId);
	return {
		revision: stored?.bindingRevision ?? 0,
		persistedTimeline: stored?.timeline,
	};
}

/**
 * Assemble the v2 snapshot for the current input. Binding revision and
 * history carry over from the previously stored snapshot so that saves
 * without binding changes never bump the revision.
 */
function buildSnapshot(
	previous: StoryboardProjectSnapshot | null,
	input: AutosaveInput,
): StoryboardProjectSnapshot {
	return {
		schemaVersion: 2,
		projectId: input.projectId,
		fileName: input.fileName,
		updatedAt: new Date().toISOString(),
		shots: input.shots,
		timeline: input.timeline,
		lastJob: input.lastJob ?? undefined,
		bindingRevision: previous?.bindingRevision ?? 0,
		bindingHistory: previous?.bindingHistory ?? [],
	};
}

/**
 * Debounced localStorage persistence for the storyboard studio. The hook also
 * owns the effective binding revision: generateVideo must receipt the revision
 * of the exact binding model it renders from, even while the debounce window
 * has not written that model yet. The persisted baseline (revision + timeline)
 * therefore lives in a ref, and flush()/getBindingRevision() expose it without
 * reading a possibly stale localStorage value.
 */
export function useStoryboardAutosave(input: AutosaveInput): StoryboardAutosaveHandle {
	const [saveStatus, setSaveStatus] = useState<StoryboardSaveStatus>('saved');
	const { fileName, lastJob, projectId, shots, timeline } = input;

	// Latest inputs, readable from flush() and the unmount cleanup without
	// stale-closure traps.
	const latestRef = useRef(input);
	latestRef.current = input;
	const disposedRef = useRef(false);

	// Last persisted baseline: the revision and timeline the previous write
	// (or the initial load) produced.
	const memoryRef = useRef<AutosaveBaseline>({ revision: 0 });
	const initializedRef = useRef(false);
	if (!initializedRef.current) {
		initializedRef.current = true;
		memoryRef.current = readBaseline(input.projectId);
	}

	/**
	 * Write the current input through the binding audit chain. Returns null
	 * when the storage write fails: the baseline stays untouched (the pending
	 * batch remains reportable via getBindingRevision) and saveStatus turns
	 * 'error' so the next edit can retry from a clean slate.
	 */
	const persist = useCallback((): StoryboardProjectSnapshot | null => {
		const {
			fileName: currentFileName,
			lastJob: currentLastJob,
			projectId: currentProjectId,
			shots: currentShots,
			timeline: currentTimeline,
		} = latestRef.current;
		const previous = loadStoryboardProject(currentProjectId);
		const events = diffStoryboardBindings(previous?.timeline, currentTimeline);
		const snapshot = buildSnapshot(previous, {
			projectId: currentProjectId,
			fileName: currentFileName,
			shots: currentShots,
			timeline: currentTimeline,
			lastJob: currentLastJob,
		});
		const next = events.length > 0 ? recordBindingEvents(snapshot, events) : snapshot;
		try {
			saveStoryboardProject(next);
		} catch {
			setSaveStatus('error');
			return null;
		}
		memoryRef.current = { revision: next.bindingRevision, persistedTimeline: currentTimeline };
		return next;
	}, []);

	// A project switch restarts the in-memory baseline from the stored snapshot.
	useEffect(() => {
		memoryRef.current = readBaseline(projectId);
	}, [projectId]);

	// Debounced autosave; consecutive edits re-arm the timer. The mount run is
	// skipped (first-run ref): opening the studio must not touch storage, only
	// a real input change schedules a write.
	const firstRunRef = useRef(true);
	useEffect(() => {
		if (firstRunRef.current) {
			firstRunRef.current = false;
			return;
		}
		setSaveStatus('saving');
		const timer = window.setTimeout(() => {
			if (persist()) {
				setSaveStatus('saved');
			}
		}, AUTOSAVE_DELAY_MS);
		return () => window.clearTimeout(timer);
		// 每个输入都是刻意的防抖触发器；timer 触发时 persist() 经 refs 读取最新值。
		// oxlint-disable-next-line react/exhaustive-effect-dependencies
	}, [fileName, lastJob, persist, projectId, shots, timeline]);

	// Flush-on-unmount: closing the studio inside the debounce window would
	// otherwise silently drop the latest edits, binding audit events included.
	// The body resets disposed on every (re)mount so that a StrictMode-style
	// remount keeps flush() working instead of nulling it forever.
	useEffect(() => {
		disposedRef.current = false;
		return () => {
			disposedRef.current = true;
			persist();
		};
	}, [persist]);

	const flush = useCallback((): StoryboardProjectSnapshot | null => {
		if (disposedRef.current) {
			return null;
		}
		const snapshot = persist();
		setSaveStatus(snapshot ? 'saved' : 'error');
		return snapshot;
	}, [persist]);

	const getBindingRevision = useCallback((): number => {
		const { persistedTimeline, revision } = memoryRef.current;
		const pending = diffStoryboardBindings(persistedTimeline, latestRef.current.timeline);
		return revision + (pending.length > 0 ? 1 : 0);
	}, []);

	return { saveStatus, flush, getBindingRevision };
}
