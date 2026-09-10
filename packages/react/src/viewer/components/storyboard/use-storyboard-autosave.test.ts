// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoryboardBindingEvent, StoryboardBindingEventAction } from './binding-history';
import type { StoryboardJobProgress } from './storyboard-job-client';
import type { StoryboardShot } from './storyboard-model';
import { loadStoryboardProject, saveStoryboardProject } from './storyboard-project-store';
import type { StoryboardProjectSnapshot } from './storyboard-project-store';
import { createTimelineBinding } from './timeline';
import type { TimelineBinding, TimelineClip, TimelineModel } from './timeline';
import { useStoryboardAutosave } from './use-storyboard-autosave';

interface AutosaveProbeInput {
	projectId: string;
	fileName: string;
	shots: StoryboardShot[];
	timeline: TimelineModel;
	lastJob: StoryboardJobProgress | null;
}

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

const BOUND_A = createTimelineBinding('anim-1', 'with-animation', 0, false);
const BOUND_B = createTimelineBinding('anim-2', 'with-animation', 500, false);

describe('useStoryboardAutosave export seam', () => {
	let container: HTMLDivElement;
	let root: Root;
	let handleRef: { current: ReturnType<typeof useStoryboardAutosave> | null };
	let unmounted: boolean;
	const inputRef: { current: AutosaveProbeInput } = {
		current: {
			projectId: 'project_x',
			fileName: 'deck.pptx',
			shots: [],
			timeline: timelineWith([narrationClip('clip-1')]),
			lastJob: null,
		},
	};

	function Probe(): null {
		handleRef.current = useStoryboardAutosave(inputRef.current);
		return null;
	}

	function renderAutosave(input: AutosaveProbeInput): void {
		inputRef.current = input;
		unmounted = false;
		act(() => {
			root.render(createElement(Probe));
		});
	}

	function baseInput(overrides: Partial<AutosaveProbeInput> = {}): AutosaveProbeInput {
		return {
			projectId: 'project_x',
			fileName: 'deck.pptx',
			shots: [shot('脚本')],
			timeline: timelineWith([narrationClip('clip-1')]),
			lastJob: null,
			...overrides,
		};
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		localStorage.clear();
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		handleRef = { current: null };
		unmounted = false;
	});

	afterEach(() => {
		if (!unmounted) {
			act(() => root.unmount());
		}
		container.remove();
		localStorage.clear();
		vi.useRealTimers();
		globalThis.IS_REACT_ACT_ENVIRONMENT = false;
	});

	it('flush persists the debounce window immediately with the correct revision', () => {
		saveStoryboardProject(
			v2Snapshot({
				bindingRevision: 2,
				bindingHistory: [event('bind')],
				timeline: timelineWith([narrationClip('clip-1', BOUND_A)]),
			}),
		);
		renderAutosave(baseInput({ timeline: timelineWith([narrationClip('clip-1', BOUND_B)]) }));
		// 挂载不再空转调度：打开工作台未编辑时保持已保存。
		expect(handleRef.current?.saveStatus).toBe('saved');
		let flushed: StoryboardProjectSnapshot | null = null;
		act(() => {
			flushed = handleRef.current?.flush() ?? null;
		});
		// 防抖窗口内 flush：rebind 批次立即落盘，导出拿到的 revision 与模型同批。
		expect(flushed?.bindingRevision).toBe(3);
		expect(handleRef.current?.getBindingRevision()).toBe(3);
		const saved = loadStoryboardProject('project_x');
		expect(saved?.bindingRevision).toBe(3);
		expect(saved?.bindingHistory).toHaveLength(2);
		expect(saved?.bindingHistory.at(-1)?.action).toBe('rebind');
		expect(saved?.bindingHistory.at(-1)?.from).toStrictEqual(BOUND_A);
		expect(saved?.bindingHistory.at(-1)?.to).toStrictEqual(BOUND_B);
		// 迟到的防抖 timer 重写同一模型时不再推批次。
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(loadStoryboardProject('project_x')?.bindingRevision).toBe(3);
		expect(handleRef.current?.getBindingRevision()).toBe(3);
	});

	it('flush returns null once the component has unmounted', () => {
		renderAutosave(baseInput());
		act(() => {
			unmounted = true;
			root.unmount();
		});
		expect(handleRef.current?.flush()).toBeNull();
	});

	it('getBindingRevision includes the pending batch before it is written', () => {
		saveStoryboardProject(
			v2Snapshot({
				bindingRevision: 3,
				bindingHistory: [event('bind')],
				timeline: timelineWith([narrationClip('clip-1', BOUND_A)]),
			}),
		);
		renderAutosave(baseInput({ timeline: timelineWith([narrationClip('clip-1', BOUND_B)]) }));
		// 挂载不再空转落盘：挂起的 rebind 批次只体现在内存回执上。
		expect(handleRef.current?.getBindingRevision()).toBe(4);
		expect(loadStoryboardProject('project_x')?.bindingRevision).toBe(3);
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(loadStoryboardProject('project_x')?.bindingRevision).toBe(3);
		// 首次真实输入变化（拖动 clip 起点）触发防抖：挂起的 rebind 批次随之落盘。
		renderAutosave(
			baseInput({
				timeline: timelineWith([{ ...narrationClip('clip-1', BOUND_B), startMs: 1500 }]),
			}),
		);
		expect(handleRef.current?.getBindingRevision()).toBe(4);
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handleRef.current?.getBindingRevision()).toBe(4);
		expect(loadStoryboardProject('project_x')?.bindingRevision).toBe(4);
	});

	it('flushes pending edits synchronously on unmount', () => {
		saveStoryboardProject(
			v2Snapshot({ timeline: timelineWith([narrationClip('clip-1', BOUND_A)]) }),
		);
		renderAutosave(baseInput({ timeline: timelineWith([narrationClip('clip-1')]) }));
		// 编辑后 300ms 内关闭工作台：防抖从未触发，卸载必须同步落盘。
		act(() => {
			unmounted = true;
			root.unmount();
		});
		const saved = loadStoryboardProject('project_x');
		expect(saved?.bindingRevision).toBe(1);
		expect(saved?.bindingHistory).toHaveLength(1);
		expect(saved?.bindingHistory[0].action).toBe('detach');
		expect(saved?.timeline).toStrictEqual(timelineWith([narrationClip('clip-1')]));
	});

	it('re-syncs the in-memory revision when the project id changes', () => {
		saveStoryboardProject(
			v2Snapshot({
				projectId: 'project_other',
				bindingRevision: 5,
				bindingHistory: [event('lock', 'clip-1')],
				timeline: timelineWith([narrationClip('clip-1', BOUND_A)]),
			}),
		);
		renderAutosave(baseInput({ timeline: timelineWith([narrationClip('clip-1', BOUND_B)]) }));
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handleRef.current?.getBindingRevision()).toBe(1);
		// 切换到已有 5 个批次的项目：基线从存储恢复，而不是沿用旧项目计数。
		renderAutosave(
			baseInput({
				projectId: 'project_other',
				timeline: timelineWith([narrationClip('clip-1', BOUND_A)]),
			}),
		);
		expect(handleRef.current?.getBindingRevision()).toBe(5);
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(loadStoryboardProject('project_other')?.bindingRevision).toBe(5);
		expect(handleRef.current?.getBindingRevision()).toBe(5);
	});

	it('flush recovers after a remount because disposed resets on mount', () => {
		renderAutosave(baseInput());
		act(() => {
			unmounted = true;
			root.unmount();
		});
		expect(handleRef.current?.flush()).toBeNull();
		// 模拟 StrictMode 式重挂载：disposed 必须在挂载时复位，flush 不能永久为 null。
		container = document.createElement('div');
		document.body.appendChild(container);
		root = createRoot(container);
		renderAutosave(baseInput({ fileName: 'again.pptx' }));
		let flushed: StoryboardProjectSnapshot | null = null;
		act(() => {
			flushed = handleRef.current?.flush() ?? null;
		});
		expect(flushed?.fileName).toBe('again.pptx');
		expect(handleRef.current?.saveStatus).toBe('saved');
	});

	it('storage write failure turns saveStatus to error and a later edit retries', () => {
		renderAutosave(baseInput());
		// happy-dom 的 localStorage 是代理实例，方法会在首次访问时以自身属性
		// 绑定到实例上；spy 必须落在实例上才能拦截 setItem。
		const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('quota exceeded');
		});
		// 挂载不落盘；首次真实输入变化触发防抖写入，但配额满：状态转 error 且不抛出。
		renderAutosave(baseInput({ fileName: 'edited.pptx' }));
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handleRef.current?.saveStatus).toBe('error');
		// 写失败不推进基线，也不卡死：写入恢复后下一次编辑重新落盘。
		setItem.mockRestore();
		renderAutosave(baseInput({ fileName: 'recovered.pptx' }));
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(handleRef.current?.saveStatus).toBe('saved');
		expect(loadStoryboardProject('project_x')?.fileName).toBe('recovered.pptx');
	});
});
