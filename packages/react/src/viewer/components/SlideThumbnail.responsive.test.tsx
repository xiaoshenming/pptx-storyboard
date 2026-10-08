// @vitest-environment happy-dom
import type { PptxSlide } from 'pptx-viewer-core';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, vi, it } from 'vitest';

import { SlideItem } from './slides-pane/SlideItem';
import { SlideThumbnail } from './SlideThumbnail';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

vi.mock<typeof import('react-i18next')>(import('react-i18next'), () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

let container: HTMLDivElement;
let root: Root;
let resizeCallback: ResizeObserverCallback | undefined;

class ResizeObserverFake {
	constructor(callback: ResizeObserverCallback) {
		resizeCallback = callback;
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

class IntersectionObserverFake {
	readonly root = null;
	readonly rootMargin = '0px';
	readonly thresholds = [0];
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

const slide = { id: 'slide-1', rId: 'rId1', slideNumber: 1, elements: [] } as PptxSlide;
const canvasSize = { width: 960, height: 540 };

beforeEach(() => {
	container = document.createElement('div');
	document.body.appendChild(container);
	root = createRoot(container);
	resizeCallback = undefined;
	vi.stubGlobal('ResizeObserver', ResizeObserverFake);
	vi.stubGlobal('IntersectionObserver', IntersectionObserverFake);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

describe('responsive slide thumbnails', () => {
	it('keeps the slide frame at 16:9 and scales its contents to the measured width', () => {
		act(() => {
			root.render(<SlideThumbnail slide={slide} templateElements={[]} canvasSize={canvasSize} />);
		});

		const frame = container.firstElementChild as HTMLDivElement;
		const contents = frame.firstElementChild as HTMLDivElement;
		expect(frame.style.aspectRatio).toBe('960 / 540');

		act(() => {
			resizeCallback?.(
				[
					{
						target: frame,
						contentRect: { width: 240 },
					} as unknown as ResizeObserverEntry,
				],
				{} as ResizeObserver,
			);
		});

		expect(contents.style.transform).toBe('scale(0.25)');
	});

	it('reserves a 16:9 frame while a lazy rail thumbnail is waiting to render', () => {
		act(() => {
			root.render(
				<SlideItem
					slide={slide}
					templateElements={[]}
					slideIndex={0}
					isActive={false}
					canvasSize={canvasSize}
					canEdit={false}
					onSelectSlide={vi.fn()}
					onSlideContextMenu={vi.fn()}
					onOpenSlideCtxMenu={vi.fn()}
					onDragStart={vi.fn()}
					onDragOver={vi.fn()}
					onDrop={vi.fn()}
					slideRef={vi.fn()}
				/>,
			);
		});

		const placeholder = container.querySelector<HTMLElement>('.animate-pulse');
		expect(placeholder?.style.aspectRatio).toBe('960 / 540');
		expect(placeholder?.style.minWidth).toBe('');
	});
});
