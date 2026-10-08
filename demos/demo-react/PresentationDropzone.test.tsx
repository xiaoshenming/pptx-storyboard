// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, vi, test } from 'vitest';

import { PresentationDropzone } from './PresentationDropzone';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onFile = vi.fn();
const file = new File(['deck'], '课件.PPTX');
function render(disabled = false) {
	act(() =>
		root.render(
			<PresentationDropzone
				label='上传演示文稿'
				disabled={disabled}
				onFile={onFile}
				onClick={() => {}}
			>
				<span>选择文件</span>
			</PresentationDropzone>,
		),
	);
}
function drag(
	type: string,
	files: File[] = [],
	target: Element = container.firstElementChild!,
	types = ['Files'],
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	const dataTransfer = { types, files, dropEffect: 'none' };
	Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
	act(() => target.dispatchEvent(event));
	return { event, dataTransfer };
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
	onFile.mockClear();
	render();
});
afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

test('highlights file hover, retains feedback across children, and clears when leaving', () => {
	drag('dragenter');
	expect(container.textContent).toContain('松开以导入');
	expect(container.firstElementChild?.getAttribute('data-drag-active')).toBe('true');
	drag('dragenter', [], container.querySelector('span')!);
	drag('dragleave', [], container.querySelector('span')!);
	expect(container.textContent).toContain('松开以导入');
	drag('dragleave');
	expect(container.firstElementChild?.getAttribute('data-drag-active')).toBe('false');
});

test('advertises copy and imports exactly once on drop, without default browser navigation', () => {
	const over = drag('dragover');
	expect(over.event.defaultPrevented).toBeTruthy();
	expect(over.dataTransfer.dropEffect).toBe('copy');
	drag('dragenter');
	expect(drag('drop', [file]).event.defaultPrevented).toBeTruthy();
	expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
	expect(container.firstElementChild?.getAttribute('data-drag-active')).toBe('false');
});

test('explains unsupported or multiple files and ignores text drags', () => {
	drag('dragenter', [], undefined, ['text/plain']);
	expect(container.textContent).not.toContain('松开以导入');
	drag('drop', [new File(['x'], 'notes.pdf')]);
	expect(container.querySelector('[role="alert"]')?.textContent).toContain('不支持');
	drag('drop', [file, file]);
	expect(container.querySelector('[role="alert"]')?.textContent).toContain('一个');
	expect(onFile).not.toHaveBeenCalled();
});

test('does not accept another file while an import is busy', () => {
	render(true);
	expect(drag('dragover').dataTransfer.dropEffect).toBe('none');
	drag('drop', [file]);
	expect(onFile).not.toHaveBeenCalled();
});
