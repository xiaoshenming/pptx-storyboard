import type React from 'react';
import { LuLayers, LuMessageSquare, LuSettings2 } from 'react-icons/lu';

import type { InspectorTab } from './inspector-pane-types';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

export const INSPECTOR_TABS: Array<{
	key: InspectorTab;
	labelKey: string;
	icon: React.ComponentType<{ className?: string }>;
}> = [
	{ key: 'elements', labelKey: 'pptx.documentProperties.statistics.elements', icon: LuLayers },
	{ key: 'properties', labelKey: 'pptx.inspector.properties', icon: LuSettings2 },
	{ key: 'comments', labelKey: 'pptx.toolbar.comments', icon: LuMessageSquare },
];

// ---------------------------------------------------------------------------
// Reusable CSS class-name tokens
// ---------------------------------------------------------------------------

export const HEADING = 'text-[11px] uppercase tracking-wide text-muted-foreground';
export const CARD = 'rounded border border-border bg-card p-2 space-y-2';
export const INPUT = 'flex-1 bg-muted border border-border rounded px-1.5 py-0.5 w-full';
export const BTN = 'rounded bg-muted hover:bg-accent px-2 py-1 text-[11px] transition-colors';

// ---------------------------------------------------------------------------
// Position / size field tuple
// ---------------------------------------------------------------------------

export const POS_FIELDS = [
	['X', 'x'],
	['Y', 'y'],
	['W', 'width'],
	['H', 'height'],
] as const;
