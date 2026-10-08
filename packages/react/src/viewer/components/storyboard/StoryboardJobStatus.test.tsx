// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi, test } from 'vitest';

import { StoryboardJobStatus } from './StoryboardJobStatus';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const cancel = vi.fn();
const job = { id: 'one', stage: 'rendering', progress: 40, tasks: [] };
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	cancel.mockClear();
	act(() => root.render(<StoryboardJobStatus job={job} onCancel={cancel} />));
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

test('dismisses outside and reopens without cancelling, but keeps inside clicks open', () => {
	const button = container.querySelector('button')!;
	act(() => button.dispatchEvent(new Event('pointerdown', { bubbles: true })));
	expect(container.textContent).toContain('阶段：');
	act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
	expect(container.textContent).not.toContain('阶段：');
	expect(button.getAttribute('aria-expanded')).toBe('false');
	act(() => button.click());
	expect(container.textContent).toContain('阶段：');
	expect(cancel).not.toHaveBeenCalled();
});

test('escape dismisses, progress updates stay collapsed, and a new job opens', () => {
	act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
	expect(container.textContent).not.toContain('阶段：');
	act(() => root.render(<StoryboardJobStatus job={{ ...job, progress: 55 }} onCancel={cancel} />));
	expect(container.textContent).not.toContain('阶段：');
	act(() => root.render(<StoryboardJobStatus job={{ ...job, id: 'two' }} onCancel={cancel} />));
	expect(container.textContent).toContain('阶段：');
	expect(cancel).not.toHaveBeenCalled();
});
