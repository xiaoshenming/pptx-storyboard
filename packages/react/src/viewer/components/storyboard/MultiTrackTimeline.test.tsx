// @vitest-environment happy-dom
/**
 * Component tests for the storyboard timeline interaction upgrade: readable
 * animation cards (A2-UI), split selection state (C1), magnet drop binding
 * (C2), the clip context menu (C4), and the playhead (E1-UI).
 *
 * Drag tests come in two flavors: stale-prop (mock onChange, legacy) and a
 * controlled loop that feeds every onChange result back through
 * `applyNarrationBindings`, mirroring the studio's `applyTimelineEdit` chain.
 *
 * No `@testing-library/react` is available in this workspace, so this uses the
 * manual `createRoot` + `act` harness pattern (see
 * `SlideNotesPanel.notes-style.test.tsx`).
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiTrackTimeline } from './MultiTrackTimeline';
import {
	applyNarrationBindings,
	createTimelineBinding,
	createTimelineModel,
	createTimelineTrack,
} from './timeline';
import type { TimelineClip, TimelineModel } from './timeline';

// Component default zoom: 80 px/s makes the 8px magnet radius exactly 100ms.
const PPS = 80;

// React 19 requires this flag for act() outside @testing-library.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function visualClip(id: string, startMs: number, durationMs: number): TimelineClip {
	return { id, trackId: 'track-visual', kind: 'visual', startMs, durationMs, sourceId: 'shot-1' };
}

function animationClip(id: string, startMs: number): TimelineClip {
	return {
		id,
		trackId: 'track-animation',
		kind: 'animation',
		startMs,
		durationMs: 800,
		sourceId: 'shot-1',
		metadata: {
			eventId: `${id}-event`,
			anchorLabel: 'A1',
			presetClass: 'entr',
			targetLabel: '标题文字',
			trigger: 'onClick',
			effectLabel: '进入动画',
		},
	};
}

function narrationClip(
	id: string,
	startMs: number,
	binding?: TimelineClip['binding'],
): TimelineClip {
	return {
		id,
		trackId: 'track-narration',
		kind: 'narration',
		startMs,
		durationMs: 1500,
		label: '旁白一',
		sourceId: 'shot-1',
		binding,
	};
}

function subtitleClip(id: string, startMs: number): TimelineClip {
	return {
		id,
		trackId: 'track-subtitle',
		kind: 'subtitle',
		startMs,
		durationMs: 1500,
		label: '字幕一',
		sourceId: 'shot-1',
	};
}

function buildTimeline(clips: TimelineClip[]): TimelineModel {
	return createTimelineModel([
		createTimelineTrack(
			'visual',
			clips.filter((clip) => clip.kind === 'visual'),
		),
		createTimelineTrack(
			'animation',
			clips.filter((clip) => clip.kind === 'animation'),
		),
		createTimelineTrack(
			'narration',
			clips.filter((clip) => clip.kind === 'narration'),
		),
		createTimelineTrack(
			'subtitle',
			clips.filter((clip) => clip.kind === 'subtitle'),
		),
	]);
}

function baseTimeline(animation: TimelineClip, narration: TimelineClip): TimelineModel {
	return buildTimeline([
		visualClip('vis-1', 0, 9000),
		animation,
		narration,
		subtitleClip('sub-1', narration.startMs),
	]);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function fire(element: Element, type: string, clientX = 0): void {
	act(() => {
		element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
	});
}

function clipCard(clipId: string): HTMLElement {
	const found = container.querySelector(`[data-clip-id='${clipId}']`);
	if (!found) {
		throw new Error(`missing clip card: ${clipId}`);
	}
	return found as HTMLElement;
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

function scroller(): Element {
	const found = container.querySelector('.overflow-auto');
	if (!found) {
		throw new Error('missing timeline scroller');
	}
	return found;
}

function lastChange(changes: TimelineModel[]): TimelineClip {
	const narrationTrack = changes[changes.length - 1].tracks.find(
		(track) => track.kind === 'narration',
	);
	return narrationTrack!.clips[0];
}

/**
 * Controlled loop: every onChange result is reconciled with
 * `applyNarrationBindings` (like the studio's applyTimelineEdit) and fed back
 * into props on the next render. This is the harness that exposes the P0
 * regression where bound narrations snapped back to their anchor mid-drag.
 */
function controlledTimeline(
	initial: TimelineModel,
	handlers: {
		onSelectClip?: (clipId: string | undefined) => void;
		onSeek?: (playheadMs: number) => void;
	} = {},
): { changes: TimelineModel[]; model: () => TimelineModel; render: () => void } {
	let current = initial;
	const changes: TimelineModel[] = [];
	const render = () => {
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={current}
					onChange={(next) => {
						const reconciled = applyNarrationBindings(next);
						changes.push(reconciled);
						current = reconciled;
					}}
					onSelectSource={() => {}}
					onSelectClip={handlers.onSelectClip}
					onSeek={handlers.onSeek}
					onPlayAll={() => {}}
				/>,
			);
		});
	};
	return { changes, model: () => current, render };
}

describe('multiTrackTimeline rendering', () => {
	it('renders two-line animation cards and no playhead by default', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(findByText('A1 · 进入')).not.toBeNull();
		expect(findByText('标题文字 点击触发')).not.toBeNull();
		expect(container.querySelector("[data-testid='playhead-line']")).toBeNull();
	});

	it('marks subtitle cards as inheriting narration timing', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(clipCard('sub-1').getAttribute('title')).toContain('时间继承自旁白');
	});

	it('shows the binding badge for a bound narration clip', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(findByText('🔗 A1')).not.toBeNull();
	});

	it('draws binding lines only for the selected narration clip', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		const rerender = (selectedClipId?: string) => {
			act(() => {
				root.render(
					<MultiTrackTimeline
						timeline={timeline}
						selectedClipId={selectedClipId}
						onChange={() => {}}
						onSelectSource={() => {}}
						onPlayAll={() => {}}
					/>,
				);
			});
		};
		rerender(undefined);
		expect(container.querySelector("[data-binding-line='narr-1']")).toBeNull();
		rerender('narr-1');
		expect(container.querySelector("[data-binding-line='narr-1']")).not.toBeNull();
	});

	it('renders a positioned playhead when playheadMs is provided', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					playheadMs={1500}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		const line = container.querySelector("[data-testid='playhead-line']") as HTMLElement;
		// 1500ms at 80px/s = 120px, minus half of the 2px line width.
		expect(line.style.left).toBe('119px');
	});

	it('seeks from the ruler on pointer down and drag', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSeek = vi.fn();
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onSeek={onSeek}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		const ruler = container.querySelector("[data-testid='timeline-ruler']");
		if (!ruler) {
			throw new Error('missing ruler');
		}
		fire(ruler, 'pointerdown', 800);
		expect(onSeek).toHaveBeenCalledWith(9000);
		fire(ruler, 'pointermove', 400);
		expect(onSeek).toHaveBeenLastCalledWith(5000);
	});
});

describe('multiTrackTimeline selection', () => {
	it('reports clip selection, shot selection and seek on click', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSelectClip = vi.fn();
		const onSelectSource = vi.fn();
		const onSeek = vi.fn();
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onSelectClip={onSelectClip}
					onSelectSource={onSelectSource}
					onSeek={onSeek}
					onChange={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('anim-1'), 'click');
		expect(onSelectClip).toHaveBeenCalledWith('anim-1');
		expect(onSelectSource).toHaveBeenCalledWith('shot-1');
		expect(onSeek).toHaveBeenCalledWith(2000);
	});

	it('deselects the clip again on a second click', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSelectClip = vi.fn();
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					selectedClipId='narr-1'
					onSelectClip={onSelectClip}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'click');
		expect(onSelectClip).toHaveBeenCalledWith(undefined);
	});
});

describe('multiTrackTimeline magnet drop', () => {
	it('snaps onto the anchor and binds on release', () => {
		const timeline = baseTimeline(animationClip('anim-1', 5000), narrationClip('narr-1', 8000));
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'pointerdown', (8000 * PPS) / 1000);
		fire(scroller(), 'pointermove', (5000 * PPS) / 1000);
		const anchor = container.querySelector("[data-anchor-id='anim-1']");
		expect(anchor).not.toBeNull();
		// The magnetized anchor is magnified while inside the snap radius.
		expect(anchor!.getAttribute('width')).toBe('12');
		fire(scroller(), 'pointerup');
		const narration = lastChange(changes);
		expect(narration.startMs).toBe(5000);
		expect(narration.binding).toStrictEqual(createTimelineBinding('anim-1', 'with-animation', 0));
		expect(container.querySelector("[data-anchor-id='anim-1']")!.getAttribute('width')).toBe('8');
	});

	it('detaches when released at a free position', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', 880);
		expect(findByText('已解绑')).not.toBeNull();
		fire(scroller(), 'pointerup');
		const narration = lastChange(changes);
		expect(narration.binding).toBeUndefined();
		expect(narration.startMs).toBe(11000);
	});

	it('blocks dragging a narration clip whose binding is locked', () => {
		const binding = { ...createTimelineBinding('anim-1', 'with-animation'), locked: true };
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, binding),
		);
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', 880);
		expect(changes).toHaveLength(0);
	});
});

describe('multiTrackTimeline controlled drag loop', () => {
	it('keeps a bound narration detached at a free landing (P0 controlled loop)', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		const controlled = controlledTimeline(timeline);
		controlled.render();
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', 880);
		controlled.render();
		// 中间态自洽：绑定已悬置，startMs 停在拖拽位置而不是弹回锚点。
		expect(controlled.changes).toHaveLength(1);
		const mid = lastChange(controlled.changes);
		expect(mid.binding).toBeUndefined();
		expect(mid.startMs).toBe(11000);
		fire(scroller(), 'pointerup');
		controlled.render();
		// 自由落点保持解绑；中间态已是最终态，不再发冗余 onChange。
		expect(controlled.changes).toHaveLength(1);
		const finalClip = lastChange(controlled.changes);
		expect(finalClip.binding).toBeUndefined();
		expect(finalClip.startMs).toBe(11000);
	});

	it('rebinds to the magnet anchor on release (P0 controlled loop)', () => {
		const timeline = buildTimeline([
			visualClip('vis-1', 0, 9000),
			animationClip('anim-1', 2000),
			animationClip('anim-2', 6000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
			subtitleClip('sub-1', 2000),
		]);
		const controlled = controlledTimeline(timeline);
		controlled.render();
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', (6000 * PPS) / 1000);
		controlled.render();
		fire(scroller(), 'pointerup');
		controlled.render();
		const finalClip = lastChange(controlled.changes);
		expect(finalClip.binding).toStrictEqual(createTimelineBinding('anim-2', 'with-animation', 0));
		expect(finalClip.startMs).toBe(6000);
	});

	it('restores the original binding when a drag is cancelled', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		const controlled = controlledTimeline(timeline);
		controlled.render();
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', 880);
		controlled.render();
		fire(scroller(), 'pointercancel');
		controlled.render();
		expect(controlled.changes).toHaveLength(2);
		const finalClip = lastChange(controlled.changes);
		expect(finalClip.binding).toStrictEqual(createTimelineBinding('anim-1', 'with-animation', 0));
		expect(finalClip.startMs).toBe(2000);
	});
});

describe('multiTrackTimeline drag guards', () => {
	it('does not toggle selection or seek when the click follows a moved drag', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSelectClip = vi.fn();
		const onSeek = vi.fn();
		const controlled = controlledTimeline(timeline, { onSelectClip, onSeek });
		controlled.render();
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		fire(scroller(), 'pointermove', 400);
		controlled.render();
		fire(scroller(), 'pointerup');
		fire(clipCard('narr-1'), 'click');
		expect(onSelectClip).not.toHaveBeenCalled();
		expect(onSeek).not.toHaveBeenCalled();
	});

	it('keeps a sub-threshold wiggle side-effect free and the click alive (P1)', () => {
		const binding = createTimelineBinding('anim-1', 'with-animation');
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, binding),
		);
		const onSelectClip = vi.fn();
		const onSeek = vi.fn();
		const controlled = controlledTimeline(timeline, { onSelectClip, onSeek });
		controlled.render();
		fire(clipCard('narr-1'), 'pointerdown', (2000 * PPS) / 1000);
		// 2px jitter: below the 3px drag threshold, so nothing may be committed.
		fire(scroller(), 'pointermove', (2000 * PPS) / 1000 + 2);
		fire(scroller(), 'pointerup');
		controlled.render();
		// Zero onChange: the bound narration never entered a detach intermediate.
		expect(controlled.changes).toHaveLength(0);
		const narration = controlled.model().tracks.find((track) => track.kind === 'narration')!
			.clips[0];
		expect(narration.binding).toStrictEqual(binding);
		expect(narration.startMs).toBe(2000);
		// The release was not a drag, so the following click still selects + seeks.
		fire(clipCard('narr-1'), 'click');
		expect(onSelectClip).toHaveBeenCalledWith('narr-1');
		expect(onSeek).toHaveBeenCalledWith(2000);
	});

	it('swallows the click that follows a moved resize drag', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSelectClip = vi.fn();
		const onSeek = vi.fn();
		const controlled = controlledTimeline(timeline, { onSelectClip, onSeek });
		controlled.render();
		const handle = container.querySelector("[data-resize-handle='anim-1']");
		if (!handle) {
			throw new Error('missing resize handle');
		}
		fire(handle, 'pointerdown', (2800 * PPS) / 1000);
		// 40px = 500ms past the threshold: a real resize drag with committed frames.
		fire(scroller(), 'pointermove', (2800 * PPS) / 1000 + 40);
		fire(scroller(), 'pointerup');
		controlled.render();
		expect(controlled.changes.length).toBeGreaterThan(0);
		const animation = controlled.model().tracks.find((track) => track.kind === 'animation')!
			.clips[0];
		expect(animation.durationMs).toBe(1300);
		// The click right after the moved resize must not select or seek.
		fire(clipCard('anim-1'), 'click');
		expect(onSelectClip).not.toHaveBeenCalled();
		expect(onSeek).not.toHaveBeenCalled();
	});

	it('starts no drag from a non-primary button press', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		act(() => {
			clipCard('narr-1').dispatchEvent(
				new MouseEvent('pointerdown', {
					bubbles: true,
					cancelable: true,
					button: 2,
					clientX: (2000 * PPS) / 1000,
				}),
			);
		});
		fire(scroller(), 'pointermove', 880);
		expect(changes).toHaveLength(0);
	});

	it('hides the resize handle for a narration clip whose binding is locked', () => {
		const binding = { ...createTimelineBinding('anim-1', 'with-animation'), locked: true };
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, binding),
		);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-resize-handle='narr-1']")).toBeNull();
		expect(container.querySelector("[data-resize-handle='anim-1']")).not.toBeNull();
	});
});

describe('multiTrackTimeline animation group brackets', () => {
	it('brackets parallel animation clips that share a start time', () => {
		const timeline = buildTimeline([
			visualClip('vis-1', 0, 9000),
			{ ...animationClip('anim-1', 2000), parallelGroupId: 'group-1' },
			{ ...animationClip('anim-2', 2000), parallelGroupId: 'group-1' },
			narrationClip('narr-1', 2000),
			subtitleClip('sub-1', 2000),
		]);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(findByText('同时播放 2 个动画')).not.toBeNull();
		const bracket = container.querySelector("[data-group-bracket='group-1']") as HTMLElement;
		expect(bracket).not.toBeNull();
		// 2000ms..2800ms at 80px/s.
		expect(bracket.style.left).toBe('160px');
		expect(bracket.style.width).toBe('64px');
		expect(bracket.getAttribute('data-group-clip-ids')).toBe('anim-1,anim-2');
	});

	it('draws no bracket for solo or ungrouped animation clips', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(container.querySelector('[data-group-bracket]')).toBeNull();
	});
});

describe('multiTrackTimeline hover info and anchor emphasis', () => {
	it('surfaces the anchor target and trigger in the narration badge title', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		const badge = findByText('🔗 A1');
		expect(badge?.getAttribute('title')).toBe('标题文字 · 点击触发');
		expect(clipCard('narr-1').getAttribute('title')).toContain('标题文字 · 点击触发');
	});

	it('emphasizes the anchor of the selected animation clip', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					selectedClipId='anim-1'
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		expect(container.querySelector("[data-anchor-id='anim-1']")!.getAttribute('width')).toBe('10');
	});
});

describe('multiTrackTimeline context menu', () => {
	it('locks the binding from the narration context menu', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'contextmenu');
		expect(findByText('锁定绑定')).not.toBeNull();
		fire(findByText('锁定绑定')!, 'click');
		expect(lastChange(changes).binding?.locked).toBeTruthy();
		expect(findByText('锁定绑定')).toBeNull();
	});

	it('restores the default binding from the context menu', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 8000));
		const changes: TimelineModel[] = [];
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={(next) => changes.push(next)}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'contextmenu');
		fire(findByText('恢复默认绑定')!, 'click');
		const narration = lastChange(changes);
		expect(narration.binding).toStrictEqual(createTimelineBinding('anim-1', 'with-animation', 0));
		expect(narration.startMs).toBe(2000);
	});

	it('locates the shot from the animation context menu', () => {
		const timeline = baseTimeline(animationClip('anim-1', 2000), narrationClip('narr-1', 2000));
		const onSelectSource = vi.fn();
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onSelectSource={onSelectSource}
					onChange={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('anim-1'), 'contextmenu');
		fire(findByText('定位到该动画')!, 'click');
		expect(onSelectSource).toHaveBeenCalledWith('shot-1');
	});

	it('closes the context menu on Escape and exposes menu roles', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		fire(clipCard('narr-1'), 'contextmenu');
		expect(clipCard('narr-1').getAttribute('aria-haspopup')).toBe('menu');
		const menu = container.querySelector("[role='menu']");
		expect(menu).not.toBeNull();
		expect(container.querySelectorAll("[role='menuitem']").length).toBeGreaterThan(0);
		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		expect(container.querySelector("[role='menu']")).toBeNull();
	});

	it('clamps the context menu inside the viewport', () => {
		const timeline = baseTimeline(
			animationClip('anim-1', 2000),
			narrationClip('narr-1', 2000, createTimelineBinding('anim-1', 'with-animation')),
		);
		act(() => {
			root.render(
				<MultiTrackTimeline
					timeline={timeline}
					onChange={() => {}}
					onSelectSource={() => {}}
					onPlayAll={() => {}}
				/>,
			);
		});
		act(() => {
			clipCard('narr-1').dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 5000,
					clientY: 5000,
				}),
			);
		});
		const menu = container.querySelector("[role='menu']") as HTMLElement;
		expect(menu).not.toBeNull();
		expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 176);
		expect(Number.parseFloat(menu.style.top)).toBeLessThan(window.innerHeight);
	});
});
