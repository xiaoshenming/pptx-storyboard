import { expect, test } from 'vitest';

import {
	collectNarrationApplication,
	narrationProtected,
	applicableNarrationNodes,
	narrationNodePatch,
} from './narration-drafts';
import type { PageNarrationDraft } from './narration-drafts';
import type { StoryboardShot } from './storyboard-model';

const shot = (script: string, extra = {}) => ({ id: 's', script, ...extra }) as StoryboardShot;

test('protects manual and legacy edits and allows explicit unlocking', () => {
	expect(narrationProtected(shot('手改'), shot('默认'))).toBeTruthy();
	expect(narrationProtected(shot('AI', { scriptOrigin: 'ai' }), shot('默认'))).toBeFalsy();
	expect(narrationProtected(shot('手改', { scriptLocked: false }), shot('默认'))).toBeFalsy();
});

test('rejects applying a stale result over newer edits', () => {
	const nodes = [{ shotId: 's', text: '新稿', sources: ['c1'] }];
	expect(
		applicableNarrationNodes(
			nodes,
			{ s: '旧稿' },
			[shot('变更', { scriptLocked: false })],
			[shot('默认')],
		),
	).toHaveLength(0);
	expect(
		applicableNarrationNodes(
			nodes,
			{ s: '旧稿' },
			[shot('旧稿', { scriptOrigin: 'ai' })],
			[shot('默认')],
		),
	).toHaveLength(1);
});

test('locks manually revised AI drafts when applying', () => {
	const patch = narrationNodePatch({ shotId: 's', text: '用户修订', sources: [] }, true);
	expect(patch.scriptOrigin).toBe('manual');
	expect(patch.scriptLocked).toBeTruthy();
	expect(
		narrationNodePatch({ shotId: 's', text: '模型草稿', sources: [] }, false).scriptOrigin,
	).toBe('ai');
});

test('combines pending pages and skips applied, protected or changed nodes', () => {
	const pages = [1, 2, 3].map((page) => ({
		page,
		baseline: { [`s${page}`]: '旧稿' },
		draft: { nodes: [{ shotId: `s${page}`, text: '新稿', sources: [] }] },
		editedShotIds: [`s${page}`],
		applied: page === 3,
	})) as PageNarrationDraft[];
	const current = [1, 2, 3].map((i) => ({
		...shot('旧稿', { scriptOrigin: 'ai', scriptLocked: i === 2 }),
		id: `s${i}`,
	}));
	const result = collectNarrationApplication(pages, current, []);
	expect(result.nodes.map((n) => n.shotId)).toStrictEqual(['s1']);
	expect(result.editedShotIds).toStrictEqual(['s1']);
	expect(result.skipped).toBe(1);
});
