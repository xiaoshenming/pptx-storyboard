// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { createCaptureScopeFilter } from './capture-scope';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('capture scope', () => {
	it('prunes editor and other capture roots without pruning the target or its ancestors', () => {
		document.body.innerHTML =
			'<main id="editor"><p>unrelated</p></main><section id="parent"><div id="target"><span>slide</span></div><aside>other worker</aside></section>';
		const target = document.querySelector<HTMLElement>('#target')!;
		const ignore = createCaptureScopeFilter(target);
		expect(ignore(document.querySelector('#editor')!)).toBeTruthy();
		expect(ignore(document.querySelector('aside')!)).toBeTruthy();
		for (const node of [
			document.documentElement,
			document.head,
			document.body,
			target.parentElement!,
			target,
			target.firstElementChild!,
		]) {
			expect(ignore(node)).toBeFalsy();
		}
	});

	it('keeps body-injected styles and external SVG definitions and their ancestor paths', () => {
		document.body.innerHTML =
			'<main><style>.slide {color:red}</style><div><svg><defs><linearGradient id="paint"><stop/></linearGradient></defs></svg></div><p>unrelated</p></main><section id="target"/>';
		const ignore = createCaptureScopeFilter(document.querySelector('#target')!);
		for (const selector of [
			'main',
			'style',
			'main > div',
			'svg',
			'defs',
			'linearGradient',
			'stop',
		]) {
			expect(ignore(document.querySelector(selector)!)).toBeFalsy();
		}
		expect(ignore(document.querySelector('p')!)).toBeTruthy();
	});
});
