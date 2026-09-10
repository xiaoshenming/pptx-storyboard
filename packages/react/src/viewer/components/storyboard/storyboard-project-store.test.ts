// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoryboardBindingEvent, StoryboardBindingEventAction } from './binding-history';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import {
	MAX_BINDING_HISTORY,
	diffStoryboardBindings,
	loadStoryboardProject,
	migrateStoryboardSnapshot,
	recordBindingEvents,
	saveStoryboardProject,
	storyboardProjectId,
} from './storyboard-project-store';
import type { StoryboardProjectSnapshot } from './storyboard-project-store';
import { createTimelineBinding } from './timeline';
import type { TimelineBinding, TimelineClip, TimelineModel } from './timeline';
import { useStoryboardAutosave } from './use-storyboard-autosave';
import type { StoryboardSaveStatus } from './use-storyboard-autosave';

function shot(script: string): StoryboardShot {
	return {
		id: 'slide-1-static',
		slideIndex: 0,
		kind: 'static',
		label: '第 1 页',
		effectLabel: '静态页面',
		durationMs: 5000,
		script,
	};
}

function job(): StoryboardJobProgress {
	return { id: 'job-1', stage: 'render', progress: 100, tasks: [] };
}

function narrationClip(id: string, binding?: TimelineBinding): TimelineClip {
	return {
		id,
		trackId: 'track-narration',
		kind: 'narration',
		startMs: 1000,
		durationMs: 2000,
		// Omit the key when unbound so fixtures match their JSON round trip.
		...(binding ? { binding } : {}),
	};
}

function timelineWith(clips: TimelineClip[]): TimelineModel {
	return {
		tracks: [{ id: 'track-narration', kind: 'narration', name: '旁白', clips }],
		frameRate: 30,
		durationMs: 10000,
	};
}

function event(action: StoryboardBindingEventAction, clipId = 'clip-1'): StoryboardBindingEvent {
	return { at: '2026-09-10T00:00:00.000Z', clipId, action };
}

function v1Snapshot(): Record<string, unknown> {
	return {
		schemaVersion: 1,
		projectId: 'project_x',
		fileName: 'deck.pptx',
		updatedAt: '2026-08-01T00:00:00.000Z',
		shots: [shot('脚本')],
		timeline: timelineWith([narrationClip('clip-1')]),
		lastJob: job(),
	};
}

function v2Snapshot(overrides: Partial<StoryboardProjectSnapshot> = {}): StoryboardProjectSnapshot {
	return {
		schemaVersion: 2,
		projectId: 'project_x',
		fileName: 'deck.pptx',
		updatedAt: '2026-08-01T00:00:00.000Z',
		shots: [shot('脚本')],
		timeline: timelineWith([narrationClip('clip-1')]),
		bindingRevision: 0,
		bindingHistory: [],
		...overrides,
	};
}

describe('storyboardProjectId', () => {
	it('separates same-name decks when their content differs', () => {
		expect(storyboardProjectId('同名.pptx', [shot('甲')])).not.toBe(
			storyboardProjectId('同名.pptx', [shot('乙')]),
		);
	});
});

describe('migrateStoryboardSnapshot', () => {
	it('migrates v1 to v2 keeping shots, timeline, lastJob and updatedAt', () => {
		const migrated = migrateStoryboardSnapshot(v1Snapshot());
		expect(migrated).toStrictEqual({
			...v1Snapshot(),
			schemaVersion: 2,
			bindingRevision: 0,
			bindingHistory: [],
		});
	});

	it('fills missing v1 metadata with empty strings instead of dropping the snapshot', () => {
		const raw = v1Snapshot();
		delete raw.fileName;
		delete raw.updatedAt;
		const migrated = migrateStoryboardSnapshot(raw);
		expect(migrated?.fileName).toBe('');
		expect(migrated?.updatedAt).toBe('');
		expect(migrated?.schemaVersion).toBe(2);
		expect(migrated?.shots).toStrictEqual(v1Snapshot().shots);
	});

	it('keeps a valid v2 snapshot intact', () => {
		const snapshot = v2Snapshot({
			bindingRevision: 3,
			bindingHistory: [event('bind'), event('lock', 'clip-2')],
			lastJob: job(),
		});
		expect(migrateStoryboardSnapshot(snapshot)).toStrictEqual(snapshot);
	});

	it('rejects values that are not snapshots', () => {
		expect(migrateStoryboardSnapshot(null)).toBeNull();
		expect(migrateStoryboardSnapshot('snapshot')).toBeNull();
		expect(migrateStoryboardSnapshot(42)).toBeNull();
		expect(migrateStoryboardSnapshot([])).toBeNull();
	});

	it('rejects unknown schema versions', () => {
		expect(migrateStoryboardSnapshot({ ...v1Snapshot(), schemaVersion: 3 })).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v1Snapshot(), schemaVersion: 0 })).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v1Snapshot(), schemaVersion: '1' })).toBeNull();
	});

	it('rejects v1 payloads missing required fields', () => {
		expect(migrateStoryboardSnapshot({ ...v1Snapshot(), projectId: 7 })).toBeNull();
		const withoutShots = v1Snapshot();
		delete withoutShots.shots;
		expect(migrateStoryboardSnapshot(withoutShots)).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v1Snapshot(), timeline: { noTracks: true } })).toBeNull();
	});

	it('rejects v2 payloads with broken binding bookkeeping', () => {
		expect(migrateStoryboardSnapshot({ ...v2Snapshot(), bindingRevision: '0' })).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v2Snapshot(), bindingRevision: 1.5 })).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v2Snapshot(), bindingRevision: -1 })).toBeNull();
		const revisionless = v2Snapshot();
		delete (revisionless as Record<string, unknown>).bindingRevision;
		expect(migrateStoryboardSnapshot(revisionless)).toBeNull();
		expect(
			migrateStoryboardSnapshot({ ...v2Snapshot(), bindingHistory: [{ at: 'x', action: 'nope' }] }),
		).toBeNull();
		expect(migrateStoryboardSnapshot({ ...v2Snapshot(), bindingHistory: [42] })).toBeNull();
		expect(
			migrateStoryboardSnapshot({
				...v2Snapshot(),
				bindingHistory: [{ at: '2026-09-10T00:00:00.000Z', clipId: 'clip-1', action: 'bind' }],
			}),
		).not.toBeNull();
	});
});

describe('loadStoryboardProject', () => {
	it('returns null when nothing was saved', () => {
		expect(loadStoryboardProject('project_x')).toBeNull();
	});

	it('round-trips a v2 snapshot through localStorage', () => {
		const snapshot = v2Snapshot({
			bindingRevision: 2,
			bindingHistory: [event('bind')],
			lastJob: job(),
		});
		saveStoryboardProject(snapshot);
		expect(loadStoryboardProject('project_x')).toStrictEqual(snapshot);
	});

	it('migrates a stored v1 snapshot into the v2 shape', () => {
		localStorage.setItem(
			'pptx-viewer:storyboard-project:v1:project_x',
			JSON.stringify(v1Snapshot()),
		);
		const loaded = loadStoryboardProject('project_x');
		expect(loaded?.schemaVersion).toBe(2);
		expect(loaded?.bindingRevision).toBe(0);
		expect(loaded?.bindingHistory).toStrictEqual([]);
		expect(loaded?.timeline).toStrictEqual(v1Snapshot().timeline);
		expect(loaded?.updatedAt).toBe('2026-08-01T00:00:00.000Z');
	});

	it('rejects other project ids and malformed payloads', () => {
		saveStoryboardProject(v2Snapshot());
		expect(loadStoryboardProject('project_other')).toBeNull();
		localStorage.setItem('pptx-viewer:storyboard-project:v1:project_x', '{not json');
		expect(loadStoryboardProject('project_x')).toBeNull();
	});
});

describe('diffStoryboardBindings', () => {
	it('emits bind when the previous timeline is unknown', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const events = diffStoryboardBindings(
			undefined,
			timelineWith([narrationClip('clip-1', binding)]),
		);
		expect(events).toHaveLength(1);
		expect(events[0].action).toBe('bind');
		expect(events[0].clipId).toBe('clip-1');
		expect(events[0].to).toStrictEqual(binding);
		expect(events[0].from).toBeUndefined();
		expect(Number.isNaN(Date.parse(events[0].at))).toBeFalsy();
	});

	it('emits bind for a previously unbound narration clip', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const events = diffStoryboardBindings(
			timelineWith([narrationClip('clip-1')]),
			timelineWith([narrationClip('clip-1', binding)]),
		);
		expect(events.map((item) => item.action)).toStrictEqual(['bind']);
		expect(events[0].to).toStrictEqual(binding);
	});

	it('emits detach when a binding is removed', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const events = diffStoryboardBindings(
			timelineWith([narrationClip('clip-1', binding)]),
			timelineWith([narrationClip('clip-1')]),
		);
		expect(events.map((item) => item.action)).toStrictEqual(['detach']);
		expect(events[0].from).toStrictEqual(binding);
		expect(events[0].to).toBeUndefined();
	});

	it('emits rebind when anchor, mode or offset changes', () => {
		const cases: Array<[TimelineBinding, TimelineBinding]> = [
			[
				createTimelineBinding('anim-1', 'with-animation', 0, false),
				createTimelineBinding('anim-2', 'with-animation', 0, false),
			],
			[
				createTimelineBinding('anim-1', 'with-animation', 0, false),
				createTimelineBinding('anim-1', 'after-animation', 0, false),
			],
			[
				createTimelineBinding('anim-1', 'with-animation', 0, false),
				createTimelineBinding('anim-1', 'with-animation', 500, false),
			],
		];
		for (const [from, to] of cases) {
			const events = diffStoryboardBindings(
				timelineWith([narrationClip('clip-1', from)]),
				timelineWith([narrationClip('clip-1', to)]),
			);
			expect(events.map((item) => item.action)).toStrictEqual(['rebind']);
			expect(events[0].from).toStrictEqual(from);
			expect(events[0].to).toStrictEqual(to);
		}
	});

	it('emits lock and unlock when only the lock flag changes', () => {
		const unlocked = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const locked = createTimelineBinding('anim-1', 'with-animation', 0, true);
		expect(
			diffStoryboardBindings(
				timelineWith([narrationClip('clip-1', unlocked)]),
				timelineWith([narrationClip('clip-1', locked)]),
			).map((item) => item.action),
		).toStrictEqual(['lock']);
		expect(
			diffStoryboardBindings(
				timelineWith([narrationClip('clip-1', locked)]),
				timelineWith([narrationClip('clip-1', unlocked)]),
			).map((item) => item.action),
		).toStrictEqual(['unlock']);
	});

	it('returns an empty array when nothing changed', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const previous = timelineWith([narrationClip('clip-1', binding)]);
		expect(diffStoryboardBindings(previous, previous)).toStrictEqual([]);
		expect(
			diffStoryboardBindings(previous, timelineWith([narrationClip('clip-1', binding)])),
		).toStrictEqual([]);
	});

	it('ignores bindings of clips that were removed together with the clip', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const events = diffStoryboardBindings(
			timelineWith([narrationClip('clip-1', binding), narrationClip('clip-2', binding)]),
			timelineWith([narrationClip('clip-1', binding)]),
		);
		expect(events).toStrictEqual([]);
	});

	it('reports one event per changed clip in track order with a shared timestamp', () => {
		const bindingA = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const bindingB = createTimelineBinding('anim-2', 'with-animation', 0, false);
		const events = diffStoryboardBindings(
			timelineWith([narrationClip('clip-1', bindingA), narrationClip('clip-2')]),
			timelineWith([narrationClip('clip-1', bindingB), narrationClip('clip-2', bindingA)]),
		);
		expect(events.map((item) => [item.clipId, item.action])).toStrictEqual([
			['clip-1', 'rebind'],
			['clip-2', 'bind'],
		]);
		expect(events[0].at).toBe(events[1].at);
	});
});

describe('recordBindingEvents', () => {
	it('returns the same reference when there are no events', () => {
		const snapshot = v2Snapshot();
		expect(recordBindingEvents(snapshot, [])).toBe(snapshot);
	});

	it('appends events at the end and bumps the revision once per batch', () => {
		const snapshot = v2Snapshot({ bindingRevision: 2, bindingHistory: [event('bind')] });
		const recorded = recordBindingEvents(snapshot, [event('lock'), event('unlock')]);
		expect(recorded).not.toBe(snapshot);
		expect(recorded.bindingRevision).toBe(3);
		expect(recorded.bindingHistory).toStrictEqual([event('bind'), event('lock'), event('unlock')]);
		expect(snapshot.bindingHistory).toStrictEqual([event('bind')]);
	});

	it('keeps only the newest events when history overflows', () => {
		const oldEvents = Array.from({ length: MAX_BINDING_HISTORY - 2 }, (_, index) =>
			event('bind', `clip-${index}`),
		);
		const snapshot = v2Snapshot({ bindingRevision: 1, bindingHistory: oldEvents });
		const recorded = recordBindingEvents(snapshot, [
			event('rebind'),
			event('detach'),
			event('lock'),
			event('unlock'),
		]);
		expect(recorded.bindingRevision).toBe(2);
		expect(recorded.bindingHistory).toHaveLength(MAX_BINDING_HISTORY);
		expect(recorded.bindingHistory[0]).toStrictEqual(event('bind', 'clip-2'));
		expect(recorded.bindingHistory.at(-1)).toStrictEqual(event('unlock'));
	});
});

describe('useStoryboardAutosave save path', () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		localStorage.clear();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
		localStorage.clear();
		vi.useRealTimers();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	// Probe 保持同一组件身份：连续 renderAutosave 是同一 hook 实例的重渲染，
	// 而不是重挂载（重挂载会复位 first-run 语义并触发卸载冲刷）。
	const inputRef: {
		current: {
			projectId: string;
			fileName: string;
			shots: StoryboardShot[];
			timeline: TimelineModel;
			lastJob: StoryboardJobProgress | null;
		} | null;
	} = { current: null };
	const statusRef: { current: StoryboardSaveStatus } = { current: 'saved' };

	function Probe(): null {
		statusRef.current = useStoryboardAutosave(inputRef.current!).saveStatus;
		return null;
	}

	function renderAutosave(input: {
		projectId: string;
		fileName: string;
		shots: StoryboardShot[];
		timeline: TimelineModel;
		lastJob: StoryboardJobProgress | null;
	}): { status: () => StoryboardSaveStatus } {
		inputRef.current = input;
		act(() => {
			root.render(createElement(Probe));
		});
		return { status: () => statusRef.current };
	}

	it('migrates a stored v1 snapshot and records the binding diff on save', () => {
		const from = createTimelineBinding('anim-1', 'with-animation', 0, false);
		const to = createTimelineBinding('anim-2', 'with-animation', 500, false);
		localStorage.setItem(
			'pptx-viewer:storyboard-project:v1:project_x',
			JSON.stringify({
				...v1Snapshot(),
				timeline: timelineWith([narrationClip('clip-1', from)]),
			}),
		);
		// 挂载不再空转调度：挂载后首次真实输入变化（重命名）才触发防抖保存。
		renderAutosave({
			projectId: 'project_x',
			fileName: 'draft.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1', to)]),
			lastJob: null,
		});
		const handle = renderAutosave({
			projectId: 'project_x',
			fileName: 'deck.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1', to)]),
			lastJob: null,
		});
		expect(handle.status()).toBe('saving');
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handle.status()).toBe('saved');
		const saved = loadStoryboardProject('project_x');
		expect(saved?.schemaVersion).toBe(2);
		expect(saved?.fileName).toBe('deck.pptx');
		expect(saved?.bindingRevision).toBe(1);
		expect(saved?.bindingHistory).toHaveLength(1);
		expect(saved?.bindingHistory[0].action).toBe('rebind');
		expect(saved?.bindingHistory[0].clipId).toBe('clip-1');
		expect(saved?.bindingHistory[0].from).toStrictEqual(from);
		expect(saved?.bindingHistory[0].to).toStrictEqual(to);
		expect(saved?.updatedAt).not.toBe('2026-08-01T00:00:00.000Z');
	});

	it('keeps revision and history when the save has no binding change', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation', 0, true);
		const stored = v2Snapshot({
			bindingRevision: 3,
			bindingHistory: [event('bind'), event('lock')],
			timeline: timelineWith([narrationClip('clip-1', binding)]),
		});
		saveStoryboardProject(stored);
		renderAutosave({
			projectId: 'project_x',
			fileName: 'draft.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1', binding)]),
			lastJob: null,
		});
		const handle = renderAutosave({
			projectId: 'project_x',
			fileName: 'deck.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1', binding)]),
			lastJob: null,
		});
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handle.status()).toBe('saved');
		const saved = loadStoryboardProject('project_x');
		expect(saved?.schemaVersion).toBe(2);
		expect(saved?.fileName).toBe('deck.pptx');
		expect(saved?.bindingRevision).toBe(3);
		expect(saved?.bindingHistory).toStrictEqual([event('bind'), event('lock')]);
	});

	it('starts from revision 0 and empty history when nothing was stored', () => {
		renderAutosave({
			projectId: 'project_x',
			fileName: 'draft.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1')]),
			lastJob: null,
		});
		renderAutosave({
			projectId: 'project_x',
			fileName: 'deck.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1')]),
			lastJob: null,
		});
		act(() => {
			vi.advanceTimersByTime(350);
		});
		const saved = loadStoryboardProject('project_x');
		expect(saved?.fileName).toBe('deck.pptx');
		expect(saved?.bindingRevision).toBe(0);
		expect(saved?.bindingHistory).toStrictEqual([]);
		expect(saved?.lastJob).toBeUndefined();
	});
});
