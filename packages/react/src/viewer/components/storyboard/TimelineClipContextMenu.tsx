import React, { useEffect } from 'react';

import { defaultBindingForNarration } from './narration-binding-actions';
import type { TimelineBinding, TimelineClip, TimelineModel } from './timeline';

export interface TimelineClipContextMenuProps {
	timeline: TimelineModel;
	clip: TimelineClip;
	x: number;
	y: number;
	onClose: () => void;
	onLockToggle: (locked: boolean) => void;
	onDetach: () => void;
	onRebindDefault: (binding: TimelineBinding) => void;
	onLocateSource: (sourceId: string) => void;
}

/** Estimated menu box (min-w-40 + py-1 + one 29px row) for viewport clamping. */
const MENU_WIDTH_PX = 176;
const MENU_ITEM_HEIGHT_PX = 29;
const MENU_PADDING_PX = 4;

/** Keeps the menu inside the viewport; pure so the clamp is unit-testable. */
export function clampMenuPosition(
	x: number,
	y: number,
	itemCount: number,
	viewport: { width: number; height: number } = {
		width: window.innerWidth,
		height: window.innerHeight,
	},
): { left: number; top: number } {
	const menuHeight = itemCount * MENU_ITEM_HEIGHT_PX + MENU_PADDING_PX * 2;
	return {
		left: Math.max(0, Math.min(x, viewport.width - MENU_WIDTH_PX)),
		top: Math.max(0, Math.min(y, viewport.height - menuHeight)),
	};
}

/** Self-drawn clip context menu (right click); closes on outside click or Escape. */
export function TimelineClipContextMenu({
	timeline,
	clip,
	x,
	y,
	onClose,
	onLockToggle,
	onDetach,
	onRebindDefault,
	onLocateSource,
}: TimelineClipContextMenuProps): React.ReactElement {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onClose]);
	const defaultBinding =
		clip.kind === 'narration' ? defaultBindingForNarration(timeline, clip) : undefined;
	const closeAfter = (run: () => void) => () => {
		run();
		onClose();
	};
	const items: { label: string; disabled?: boolean; title?: string; onSelect: () => void }[] = [];
	if (clip.kind === 'narration') {
		// 未绑定时命令由模型层拒绝，条目保持禁用态以提示不可用。
		items.push({
			label: clip.binding?.locked ? '解锁绑定' : '锁定绑定',
			disabled: !clip.binding,
			onSelect: closeAfter(() => onLockToggle(!clip.binding?.locked)),
		});
		items.push({ label: '解除绑定', disabled: !clip.binding, onSelect: closeAfter(onDetach) });
		// 同分镜没有动画时没有"默认"可言（跨分镜建议有误导性），条目禁用。
		items.push({
			label: '恢复默认绑定',
			disabled: !defaultBinding,
			title: defaultBinding ? undefined : '当前分镜没有自己的动画',
			onSelect: closeAfter(() => {
				if (defaultBinding) {
					onRebindDefault(defaultBinding);
				}
			}),
		});
	} else if (clip.kind === 'animation' && clip.sourceId) {
		const sourceId = clip.sourceId;
		items.push({ label: '定位到该动画', onSelect: closeAfter(() => onLocateSource(sourceId)) });
	}
	const { left, top } = clampMenuPosition(x, y, items.length);
	return (
		<>
			<div
				className='fixed inset-0 z-40'
				onPointerDown={onClose}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div
				role='menu'
				className='fixed z-50 min-w-40 overflow-hidden rounded-md border border-white/10 bg-slate-900 py-1 text-xs shadow-xl'
				style={{ left, top }}
			>
				{items.map((item) => (
					<button
						key={item.label}
						type='button'
						role='menuitem'
						disabled={item.disabled}
						title={item.title}
						onClick={item.onSelect}
						className='block w-full px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 disabled:cursor-default disabled:text-slate-600 disabled:hover:bg-transparent'
					>
						{item.label}
					</button>
				))}
			</div>
		</>
	);
}
