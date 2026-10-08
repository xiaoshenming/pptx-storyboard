import type React from 'react';
import { useTranslation } from 'react-i18next';

import type { SlideContextMenuState } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SlideContextMenuProps {
	state: SlideContextMenuState;
	onAddSection?: (name: string, afterSlideIndex: number) => void;
	onDeleteSlide?: (index: number) => void;
	canDelete?: boolean;
	onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlideContextMenu({
	state,
	onAddSection,
	onDeleteSlide,
	canDelete = false,
	onClose,
}: SlideContextMenuProps): React.ReactElement {
	const { t } = useTranslation();

	return (
		<div
			role='menu'
			tabIndex={-1}
			aria-label={t('pptx.contextMenu.ariaLabel')}
			className='fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-xl'
			style={{
				left: Math.max(8, Math.min(state.x, window.innerWidth - 196)),
				top: Math.max(8, Math.min(state.y, window.innerHeight - 96)),
			}}
			onClick={(e: React.MouseEvent) => e.stopPropagation()}
		>
			<button
				role='menuitem'
				type='button'
				className='flex w-full items-center px-3 py-1.5 text-xs text-foreground hover:bg-muted'
				onClick={() => {
					onAddSection?.(t('pptx.sections.defaultName'), state.slideIndex);
					onClose();
				}}
			>
				{t('pptx.sections.addBefore')}
			</button>
			<button
				role='menuitem'
				type='button'
				disabled={!canDelete || !onDeleteSlide}
				className='flex w-full items-center px-3 py-1.5 text-xs text-red-500 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'
				onClick={() => {
					onDeleteSlide?.(state.slideIndex);
					onClose();
				}}
			>
				{t('pptx.slidesPanel.deleteSlide')}
			</button>
		</div>
	);
}
