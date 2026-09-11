// @vitest-environment happy-dom
/**
 * Tests for the C3 narration binding editor and the D1 script duration
 * feedback (work orders C3 + D1).
 *
 * No `@testing-library/react` is available in this workspace, so this follows
 * the manual `createRoot` + `act` harness pattern used by
 * `SlideNotesPanel.notes-style.test.tsx` and `OutlineViewOverlay.test.tsx`.
 */
import type { PptxSlide } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bindingOutcomePreview, splitAnimationClips } from './narration-binding-view-model';
import {
	BINDING_HINT,
	NarrationBindingEditor,
	STATIC_SHOT_ADVANCED,
	STATIC_SHOT_HINT,
	animationClipOptionLabel,
	scriptDriftFeedback,
	suggestedAnchorId,
} from './NarrationBindingEditor';
import type { StoryboardShot } from './storyboard-model';
import { StoryboardScriptPanel } from './StoryboardScriptPanel';
import { createTimelineBinding, createTimelineModel, createTimelineTrack } from './timeline';
import type { TimelineBinding, TimelineClip, TimelineModel } from './timeline';

function animationClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
	return {
		id: 'animation-a1',
		trackId: 'track-animation',
		kind: 'animation',
		startMs: 0,
		durationMs: 1000,
		label: '飞入',
		sourceId: 'shot-1',
		metadata: {
			anchorLabel: 'A1',
			presetClass: 'entr',
			targetLabel: '数字 60',
			trigger: 'onClick',
			groupLabel: '动画组 1',
		},
		...overrides,
	};
}

function narrationClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
	return {
		id: 'script-shot-1',
		trackId: 'track-narration',
		kind: 'narration',
		startMs: 0,
		durationMs: 4000,
		label: '旁白',
		sourceId: 'shot-1',
		...overrides,
	};
}

let container: HTMLDivElement;
let root: Root;
let changes: (TimelineBinding | undefined)[];

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
	changes = [];
});
afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function onChange(binding: TimelineBinding | undefined): void {
	changes.push(binding);
}

function lastChange(): TimelineBinding | undefined {
	return changes[changes.length - 1];
}

function findByText(text: string): HTMLElement | null {
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
	let node = walker.nextNode();
	while (node) {
		if (node instanceof HTMLElement && node.textContent === text && node.children.length === 0) {
			return node;
		}
		node = walker.nextNode();
	}
	return null;
}

/** Matches headings that mix icons and text, where `findByText` is too strict. */
function includesText(text: string): boolean {
	return container.textContent?.includes(text) === true;
}

function findButton(label: string): HTMLButtonElement {
	const button = findByText(label);
	expect(button).toBeTruthy();
	return button as HTMLButtonElement;
}

function findAnchorSelect(scope: HTMLElement = container): HTMLSelectElement {
	const select = Array.from(scope.querySelectorAll('select')).find((candidate) =>
		Array.from(candidate.options).some((option) => option.value === ''),
	);
	expect(select).toBeDefined();
	return select as HTMLSelectElement;
}

function buildTimelineModel(clips: TimelineClip[]): TimelineModel {
	return createTimelineModel([
		createTimelineTrack(
			'animation',
			clips.filter((clip) => clip.kind === 'animation'),
		),
		createTimelineTrack(
			'narration',
			clips.filter((clip) => clip.kind === 'narration'),
		),
	]);
}

function renderEditor(
	clip?: TimelineClip,
	clips: TimelineClip[] = [animationClip()],
	timeline?: TimelineModel,
): void {
	act(() => {
		root.render(
			<NarrationBindingEditor
				narrationClip={clip}
				animationClips={clips}
				onChange={onChange}
				timeline={timeline}
			/>,
		);
	});
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(
			globalThis.HTMLSelectElement.prototype,
			'value',
		)?.set;
		setter?.call(select, value);
		select.dispatchEvent(new Event('change', { bubbles: true }));
	});
}

function setInputValue(input: HTMLInputElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(
			globalThis.HTMLInputElement.prototype,
			'value',
		)?.set;
		setter?.call(input, value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
}

describe('suggestedAnchorId', () => {
	it('prefers the earliest same-shot entrance with a text target (audit C3)', () => {
		const clips = [
			animationClip({
				id: 'animation-a-exit',
				startMs: 500,
				metadata: { anchorLabel: 'A1', presetClass: 'exit', targetLabel: '旧标题' },
			}),
			animationClip({ id: 'animation-a-entr', startMs: 3000 }),
		];
		expect(suggestedAnchorId(clips, 'shot-1')).toBe('animation-a-entr');
	});

	it('skips entrances without a text target', () => {
		const clips = [
			animationClip({
				id: 'animation-a-notext',
				startMs: 1000,
				metadata: { anchorLabel: 'A1', presetClass: 'entr' },
			}),
			animationClip({ id: 'animation-a-text', startMs: 2000 }),
		];
		expect(suggestedAnchorId(clips, 'shot-1')).toBe('animation-a-text');
	});

	it('falls back to the earliest animation of the same shot without an entrance', () => {
		const clips = [
			animationClip({ id: 'animation-a0', metadata: { anchorLabel: 'A1', presetClass: 'exit' } }),
			animationClip({ id: 'animation-a1', sourceId: 'shot-2' }),
		];
		expect(suggestedAnchorId(clips, 'shot-1')).toBe('animation-a0');
	});

	it('returns undefined for a shot without its own animations (no cross-shot default)', () => {
		const clips = [
			animationClip({ id: 'animation-a9', startMs: 500, sourceId: 'shot-9' }),
			animationClip({ id: 'animation-a1', startMs: 100 }),
		];
		expect(suggestedAnchorId(clips, 'shot-2')).toBeUndefined();
	});

	it('returns undefined for an empty clip list', () => {
		expect(suggestedAnchorId([], 'shot-1')).toBeUndefined();
	});
});

describe('animationClipOptionLabel', () => {
	it('joins anchor label, preset class and target label', () => {
		expect(animationClipOptionLabel(animationClip())).toBe('A1 · 进入 · 数字 60');
	});

	it('falls back to the clip label when the target label is missing', () => {
		const clip = animationClip({ metadata: { anchorLabel: 'A2', presetClass: 'exit' } });
		expect(animationClipOptionLabel(clip)).toBe('A2 · 退出 · 飞入');
	});
});

describe('bindingOutcomePreview', () => {
	it('formats the current and resolved start with one decimal', () => {
		const clip = narrationClip({
			startMs: 530,
			binding: createTimelineBinding('animation-a1', 'with-animation', 0, false),
		});
		const timeline = buildTimelineModel([animationClip({ startMs: 5000 }), clip]);
		expect(bindingOutcomePreview(timeline, clip)).toBe('当前 0.5s → 绑定后 5.0s');
	});

	it('flags a negative resolved start as clamped to zero', () => {
		const clip = narrationClip({
			binding: createTimelineBinding('animation-a1', 'before-animation', -6000, false),
		});
		const timeline = buildTimelineModel([animationClip(), clip]);
		expect(bindingOutcomePreview(timeline, clip)).toBe('当前 0.0s → 绑定后 0.0s（将被钳到 0）');
	});

	it('returns undefined without a binding or a resolvable anchor', () => {
		const timeline = buildTimelineModel([animationClip(), narrationClip()]);
		expect(bindingOutcomePreview(timeline, narrationClip())).toBeUndefined();
		const missing = narrationClip({
			binding: createTimelineBinding('animation-missing', 'with-animation', 0, false),
		});
		expect(bindingOutcomePreview(timeline, missing)).toBeUndefined();
	});
});

describe('splitAnimationClips', () => {
	it('splits clips by the narration source id', () => {
		const own = animationClip();
		const other = animationClip({ id: 'animation-b1', sourceId: 'shot-2' });
		expect(splitAnimationClips([own, other], 'shot-1')).toStrictEqual({
			own: [own],
			others: [other],
		});
	});

	it('treats every clip as other-shot when the narration has no source id', () => {
		const own = animationClip();
		expect(splitAnimationClips([own], undefined)).toStrictEqual({ own: [], others: [own] });
	});
});

describe('scriptDriftFeedback', () => {
	it('returns undefined when there is no narration clip', () => {
		expect(scriptDriftFeedback('x'.repeat(45), undefined)).toBeUndefined();
	});

	it('returns undefined when the drift is within tolerance', () => {
		expect(scriptDriftFeedback('x'.repeat(23), 5000)).toBeUndefined();
	});

	it('reports a longer estimate that will push following shots', () => {
		expect(scriptDriftFeedback('x'.repeat(45), 4000)).toStrictEqual({
			direction: 'longer',
			seconds: '6.0',
		});
	});

	it('reports a shorter estimate that could pull following shots in', () => {
		expect(scriptDriftFeedback('x'.repeat(45), 20000)).toStrictEqual({
			direction: 'shorter',
			seconds: '10.0',
		});
	});
});

describe('narrationBindingEditor', () => {
	it('shows the unavailable state without a narration clip', () => {
		renderEditor(undefined);
		expect(findByText('当前分镜没有可绑定的动画')).toBeTruthy();
		expect(container.querySelector('select')).toBeFalsy();
	});

	it('shows the unavailable state when there are no animation clips', () => {
		renderEditor(narrationClip(), []);
		expect(findByText('当前分镜没有可绑定的动画')).toBeTruthy();
	});

	it('offers the free-time placeholder, a hint and a suggestion while unbound', () => {
		renderEditor(narrationClip());
		const select = findAnchorSelect();
		expect(select.value).toBe('');
		expect(findByText('自由时间（未绑定）')).toBeTruthy();
		expect(findByText(BINDING_HINT)).toBeTruthy();
		expect(includesText('跟随动画（锚点）')).toBeTruthy();
		expect(findByText('建议绑定：A1 · 进入 · 数字 60（本分镜第一个出现内容的动画）→')).toBeTruthy();
	});

	it('hints that timeline clicks bind and unbind directly', () => {
		renderEditor(narrationClip());
		expect(findByText(BINDING_HINT)).toBeTruthy();
		expect(container.textContent).toContain('点击时间轴上的动画卡');
	});

	it('binds from the clickable suggestion row', () => {
		renderEditor(narrationClip());
		const suggestion = container.querySelector<HTMLButtonElement>(
			"[data-testid='binding-suggestion']",
		);
		expect(suggestion?.tagName).toBe('BUTTON');
		act(() => {
			suggestion!.click();
		});
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'with-animation', 0, false),
		);
	});

	it('shows the static-shot state with a collapsed advanced form for shots without animations', () => {
		renderEditor(narrationClip(), [
			animationClip({ id: 'animation-other', sourceId: 'shot-2', startMs: 8000 }),
		]);
		expect(findByText(STATIC_SHOT_HINT)).toBeTruthy();
		const details = container.querySelector('details');
		expect(details).toBeTruthy();
		expect(details?.open).toBeFalsy();
		expect(findByText(STATIC_SHOT_ADVANCED)).toBeTruthy();
		expect(details?.querySelector('select')).toBeTruthy();
		// 无建议：静态分镜没有"默认绑定"可言。
		expect(container.textContent?.includes('建议绑定')).toBeFalsy();
	});

	it('groups the anchor select into own-shot and other-shot optgroups', () => {
		const clips = [
			animationClip({ startMs: 2000 }),
			animationClip({
				id: 'animation-b1',
				sourceId: 'shot-2',
				startMs: 8000,
				metadata: { anchorLabel: 'B1', presetClass: 'exit', targetLabel: '别页标题' },
			}),
		];
		renderEditor(narrationClip(), clips);
		const select = findAnchorSelect();
		const own = select.querySelector('optgroup[label="本分镜的动画"]');
		const others = select.querySelector('optgroup[label="其他分镜的动画（高级）"]');
		expect(own?.querySelectorAll('option').length).toBe(1);
		expect(others?.querySelectorAll('option').length).toBe(1);
		// "自由时间（未绑定）"占位在分组之外置顶。
		const firstChild = select.children[0] as HTMLOptionElement;
		expect(firstChild.tagName).toBe('OPTION');
		expect(firstChild.textContent).toBe('自由时间（未绑定）');
	});

	it('previews the bound outcome against the current start', () => {
		const clip = narrationClip({
			binding: createTimelineBinding('animation-a1', 'with-animation', 0, false),
		});
		const anchor = animationClip({ startMs: 5000 });
		renderEditor(clip, [anchor], buildTimelineModel([anchor, clip]));
		expect(findByText('当前 0.0s → 绑定后 5.0s')).toBeTruthy();
	});

	it('reports a negative bound outcome as clamped to zero', () => {
		const clip = narrationClip({
			binding: createTimelineBinding('animation-a1', 'before-animation', -6000, false),
		});
		renderEditor(clip, [animationClip()], buildTimelineModel([animationClip(), clip]));
		expect(findByText('当前 0.0s → 绑定后 0.0s（将被钳到 0）')).toBeTruthy();
	});

	it('hides the outcome preview while unbound', () => {
		renderEditor(
			narrationClip(),
			[animationClip()],
			buildTimelineModel([animationClip(), narrationClip()]),
		);
		// 固定说明含"绑定后"字样，预览行特征是"→ 绑定后"。
		expect(container.textContent?.includes('→ 绑定后')).toBeFalsy();
	});

	it('emits a fresh with-animation binding when an anchor is picked', () => {
		renderEditor(narrationClip());
		setSelectValue(findAnchorSelect(), 'animation-a1');
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'with-animation', 0, false),
		);
	});

	it('reflects the current binding in select, mode, offset and badge', () => {
		renderEditor(
			narrationClip({
				binding: createTimelineBinding('animation-a1', 'before-animation', -500, true),
			}),
		);
		expect(findAnchorSelect().value).toBe('animation-a1');
		const active = container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
		expect(active?.textContent).toBe('动画前');
		expect(container.querySelector<HTMLInputElement>('input[type="number"]').value).toBe('-500');
		expect(findByText('🔗 A1 -0.5s')).toBeTruthy();
		expect(
			(container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
		).toBeTruthy();
	});

	it('keeps unchanged fields when switching the binding mode', () => {
		renderEditor(
			narrationClip({
				binding: createTimelineBinding('animation-a1', 'before-animation', -500, true),
			}),
		);
		act(() => {
			findButton('动画同时').click();
		});
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'with-animation', -500, true),
		);
	});

	it('keeps mode and lock when editing the offset', () => {
		renderEditor(
			narrationClip({
				binding: createTimelineBinding('animation-a1', 'before-animation', -500, true),
			}),
		);
		setInputValue(container.querySelector<HTMLInputElement>('input[type="number"]'), '-300');
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'before-animation', -300, true),
		);
	});

	it('keeps anchor, mode and offset when locking the binding', () => {
		renderEditor(
			narrationClip({
				binding: createTimelineBinding('animation-a1', 'after-animation', 250, false),
			}),
		);
		act(() => {
			(container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
		});
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'after-animation', 250, true),
		);
	});

	it('emits undefined when unbinding', () => {
		renderEditor(
			narrationClip({ binding: createTimelineBinding('animation-a1', 'with-animation', 0, false) }),
		);
		act(() => {
			findButton('解除绑定').click();
		});
		expect(lastChange()).toBeUndefined();
	});

	it('emits undefined when a bound clip picks the free-time option', () => {
		renderEditor(
			narrationClip({ binding: createTimelineBinding('animation-a1', 'with-animation', 0, false) }),
		);
		setSelectValue(findAnchorSelect(), '');
		expect(lastChange()).toBeUndefined();
	});
});

describe('storyboardScriptPanel binding + duration feedback', () => {
	const slide: PptxSlide = { id: 's1', rId: 'rId2', slideNumber: 1, elements: [] };
	const noop = (): void => undefined;

	function renderPanel(script: string, clip?: TimelineClip): void {
		const shot: StoryboardShot = {
			id: 'shot-1',
			slideIndex: 0,
			kind: 'animation',
			label: '分镜 1',
			effectLabel: '淡入',
			durationMs: 5000,
			script,
		};
		act(() => {
			root.render(
				<StoryboardScriptPanel
					shot={shot}
					slide={slide}
					voiceType={101001}
					speed={0}
					narrationClip={clip}
					animationClips={[animationClip()]}
					onBindingChange={onChange}
					onScriptChange={noop}
					onVoiceTypeChange={noop}
					onSpeedChange={noop}
					onAudioPreview={noop}
					onSubtitlesEnabledChange={noop}
				/>,
			);
		});
	}

	it('estimates the narration duration with the shared script estimator', () => {
		renderPanel('x'.repeat(45));
		expect(findByText('约 10 秒')).toBeTruthy();
	});

	it('warns that a longer script will delay following shots', () => {
		renderPanel('x'.repeat(45), narrationClip({ durationMs: 4000 }));
		expect(findByText('将顺延后续画面约 6.0 秒')).toBeTruthy();
		expect(findByText('锚点保持不变，TTS 重算后自动对齐')).toBeTruthy();
	});

	it('hints that a shorter script could tighten following shots', () => {
		renderPanel('x'.repeat(45), narrationClip({ durationMs: 20000 }));
		expect(findByText('可缩短后续画面约 10.0 秒')).toBeTruthy();
	});

	it('stays quiet when the estimate matches the narration clip', () => {
		renderPanel('x'.repeat(45));
		expect(findByText('锚点保持不变，TTS 重算后自动对齐')).toBeFalsy();
	});

	it('routes binding edits from the embedded editor to onBindingChange', () => {
		renderPanel('x'.repeat(45), narrationClip());
		expect(includesText('动画绑定')).toBeTruthy();
		setSelectValue(findAnchorSelect(), 'animation-a1');
		expect(lastChange()).toStrictEqual(
			createTimelineBinding('animation-a1', 'with-animation', 0, false),
		);
	});
});
