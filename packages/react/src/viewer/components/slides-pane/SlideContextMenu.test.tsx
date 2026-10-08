// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi, test } from 'vitest';

import { SlideContextMenu } from './SlideContextMenu';

vi.mock(import('react-i18next'), () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onDeleteSlide = vi.fn();
const onClose = vi.fn();
function render(canDelete = true) {
	act(() =>
		root.render(
			<SlideContextMenu
				state={{ x: 20, y: 30, slideIndex: 2 }}
				onDeleteSlide={onDeleteSlide}
				canDelete={canDelete}
				onClose={onClose}
			/>,
		),
	);
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	onDeleteSlide.mockClear();
	onClose.mockClear();
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

test('deletes the right-clicked slide and closes the menu', () => {
	render();
	const button = Array.from(container.querySelectorAll('button')).find(
		(el) => el.textContent === 'pptx.slidesPanel.deleteSlide',
	);
	expect(button).toBeDefined();
	act(() => button!.click());
	expect(onDeleteSlide).toHaveBeenCalledExactlyOnceWith(2);
	expect(onClose).toHaveBeenCalledOnce();
});

test('disables deleting the only remaining slide', () => {
	render(false);
	const button = Array.from(container.querySelectorAll('button')).find(
		(el) => el.textContent === 'pptx.slidesPanel.deleteSlide',
	);
	expect(button?.disabled).toBeTruthy();
	act(() => button?.click());
	expect(onDeleteSlide).not.toHaveBeenCalled();
});
