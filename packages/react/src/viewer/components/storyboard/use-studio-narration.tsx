import type { PptxSlide } from 'pptx-viewer-core';
import type { NarrationDraft } from 'pptx-viewer-shared';
import React, { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { narrationNodePatch, narrationProtected } from './narration-drafts';
import { NarrationWorkspace } from './NarrationWorkspace';
import type { StoryboardShot } from './storyboard-model';

export function useStudioNarration(options: {
	scriptEndpoint?: string;
	slides: PptxSlide[];
	shots: StoryboardShot[];
	generated: StoryboardShot[];
	selected?: StoryboardShot;
	updateShot: (id: string, patch: Partial<StoryboardShot>) => void;
	updateShots: (patches: Array<{ id: string; patch: Partial<StoryboardShot> }>) => void;
	setAudioPreviews: Dispatch<
		SetStateAction<Record<string, { url: string; durationMs: number; taskId: string }>>
	>;
}) {
	const [open, setOpen] = useState(false);
	const cache = useRef(new Map<string, NarrationDraft>());
	const dialog =
		open && options.selected ? (
			<NarrationWorkspace
				endpoint={
					options.scriptEndpoint?.replace(/\/generate\/?$/, '/narration') ??
					'/api/storyboard/narration'
				}
				slides={options.slides}
				shots={options.shots}
				generated={options.generated}
				currentPage={options.selected.slideIndex}
				cache={cache.current}
				onClose={() => setOpen(false)}
				onApply={(nodes, editedShotIds) => {
					options.updateShots(
						nodes.map((node) => ({
							id: node.shotId,
							patch: narrationNodePatch(node, editedShotIds.includes(node.shotId)),
						})),
					);
					options.setAudioPreviews((current) =>
						Object.fromEntries(
							Object.entries(current).filter(([id]) => !nodes.some((n) => n.shotId === id)),
						),
					);
				}}
			/>
		) : null;
	return {
		dialog,
		open: () => setOpen(true),
		scriptProtected: options.selected
			? narrationProtected(
					options.selected,
					options.generated.find((s) => s.id === options.selected?.id),
				)
			: true,
		changeScript: (script: string) => {
			if (!options.selected) {
				return;
			}
			const id = options.selected.id;
			options.updateShot(id, narrationNodePatch({ shotId: id, text: script, sources: [] }, true));
			options.setAudioPreviews((current) =>
				Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
			);
		},
	};
}
