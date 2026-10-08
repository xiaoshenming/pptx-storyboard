/* oxlint-disable eslint/one-var -- pervasive pre-existing pattern in this file
   (many independent short-lived `const`s per hook/handler, several separated
   by comments or guard clauses); merging them isn't a style choice here. */
import { PptxHandler } from 'pptx-viewer-core';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';

// The openable-file allow list comes from the binding's public surface, not a
// local regex: a hand-rolled `.pptx|.ppt|.json` refused a `.pptm` on drop that
// the viewer's own File > Open accepted.
import { PPTX_OPEN_ACCEPT } from '../../packages/react/src/index';
import {
	themeToCssVars,
	vermilionDarkTheme,
	vermilionLightTheme,
} from '../../packages/react/src/theme';
import type { ViewerTheme } from '../../packages/react/src/theme';
import {
	PowerPointViewer,
	isAudienceTab,
	loadAudienceContent,
	parseAudienceNonce,
	rememberSessionDeck,
	storeAudienceContent,
} from '../../packages/react/src/viewer';
import type { CollaborationConfig, PowerPointViewerHandle } from '../../packages/react/src/viewer';
import type { LocalProject } from '../../packages/shared/src/render/project-library';
import { useDemoAiConfig } from './ai-config';
import i18nInstance from './i18n'; // Initialises i18next before any component renders
import { PresentationDropzone } from './PresentationDropzone';
import { ProjectLibrary, useProjectLibrary } from './project-library';
import type { ProjectGenerationProgress, QuickVideoSettings } from './project-library';
import { TtsProviderSettings } from './TtsProviderSettings';

import './app.css';

// ── Server URL safety ──────────────────────────────────────────────────────
// Security model:
//   - Any wss:// (secure WebSocket, TLS) server is trusted: same rationale as
//     trusting HTTPS. This enables collab on deployed demos (e.g. GitHub Pages)
//     without requiring a build-time VITE_COLLAB_SERVER_URL.
//   - Insecure ws:// is restricted to loopback (local dev) or a configured relay.
//   - Non-WebSocket URLs are always rejected.
const TRUSTED_COLLAB_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// A deploy can configure its own y-websocket relay at build time; that host is
// then trusted for URL-driven auto-join / file fetch (see isTrustedServerUrl).
const CONFIGURED_SERVER_URL = import.meta.env.VITE_COLLAB_SERVER_URL?.trim() ?? '';

function isTrustedServerUrl(url: string): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
			return false;
		}
		// Any wss:// (secure WebSocket, TLS required) is trusted — the same
		// rationale as trusting HTTPS: an attacker cannot impersonate the host
		// without a valid certificate for it.
		if (u.protocol === 'wss:') {
			return true;
		}
		// Insecure ws:// is restricted to loopback (local dev) or a configured relay.
		if (TRUSTED_COLLAB_HOSTS.includes(u.hostname)) {
			return true;
		}
		if (CONFIGURED_SERVER_URL) {
			try {
				return new URL(CONFIGURED_SERVER_URL).host === u.host;
			} catch {
				return false;
			}
		}
		return false;
	} catch {
		return false;
	}
}

/** Whether a session config uses the serverless peer-to-peer (webrtc) transport. */
function isP2PConfig(config: CollaborationConfig): boolean {
	return config.transport === 'webrtc' || config.serverUrl.trim().length === 0;
}

/**
 * Cryptographically strong base-36 token of `length` characters, a drop-in
 * replacement for the insecure `Math.random().toString(36)` idiom.
 */
function secureRandomToken(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = '';
	for (const b of bytes) {
		out += (b % 36).toString(36);
	}
	return out;
}

/** Random hex colour for a local presence cursor. */
function randomCursorColor(): string {
	const bytes = new Uint8Array(3);
	crypto.getRandomValues(bytes);
	return `#${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Parse a comma-separated `?signaling=` list into a clean URL array. */
function parseSignaling(raw: string | null): string[] | undefined {
	if (!raw) {
		return undefined;
	}
	const list = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length > 0 ? list : undefined;
}

// ── Default collaboration server resolution ─────────────────────────────────
// The demo ships without a public relay, so the default server URL must adapt
// to where the demo is running:
//
//   • Local dev (localhost/127.0.0.1): default to `ws://localhost:1234`, the
//     URL printed by `bun run collab`.
//   • Deployed static host (e.g. GitHub Pages): there is NO server to talk to,
//     and an https:// page cannot open a ws:// (insecure) socket without a
//     mixed-content failure. So we never hard-default to ws://localhost there.
//     Instead we honour a build-time `VITE_COLLAB_SERVER_URL` (a wss:// relay
//     the deploy can configure) and otherwise leave the field blank so the
//     user is prompted to paste their own wss:// server.
//
// A deploy can always override the default by setting VITE_COLLAB_SERVER_URL.
function isLocalhostOrigin(): boolean {
	if (typeof window === 'undefined') {
		return true;
	}
	return TRUSTED_COLLAB_HOSTS.includes(window.location.hostname);
}

/**
 * Resolve the default collaboration server URL for the current origin.
 *
 * Returns a configured wss:// relay if one was provided at build time,
 * `ws://localhost:1234` in local dev, or an empty string on a deployed origin
 * with no relay configured (so the Share dialog asks the user for a URL rather
 * than silently pointing at an unreachable / mixed-content socket).
 */
function resolveDefaultServerUrl(): string {
	if (CONFIGURED_SERVER_URL) {
		return CONFIGURED_SERVER_URL;
	}
	return isLocalhostOrigin() ? 'ws://localhost:1234' : '';
}

// ── Theme presets ──────────────────────────────────────────────────────────

interface ThemePreset {
	label: string;
	theme: ViewerTheme;
}

const themes: Record<string, ThemePreset> = {
	dark: {
		label: 'Dark',
		theme: {
			colors: {
				background: '#030712',
				foreground: '#f3f4f6',
				card: '#111827',
				cardForeground: '#f3f4f6',
				popover: '#111827',
				popoverForeground: '#f3f4f6',
				primary: '#6366f1',
				primaryForeground: '#ffffff',
				secondary: '#1f2937',
				secondaryForeground: '#f3f4f6',
				muted: '#1f2937',
				mutedForeground: '#9ca3af',
				accent: '#1f2937',
				accentForeground: '#f3f4f6',
				destructive: '#ef4444',
				destructiveForeground: '#ffffff',
				border: '#374151',
				input: '#374151',
				ring: '#6366f1',
			},
		},
	},
	light: {
		label: 'Light',
		theme: {
			colors: {
				background: '#f8fafc',
				foreground: '#0f172a',
				card: '#ffffff',
				cardForeground: '#0f172a',
				popover: '#ffffff',
				popoverForeground: '#0f172a',
				primary: '#4f46e5',
				primaryForeground: '#ffffff',
				secondary: '#f1f5f9',
				secondaryForeground: '#0f172a',
				muted: '#f1f5f9',
				mutedForeground: '#64748b',
				accent: '#f1f5f9',
				accentForeground: '#0f172a',
				destructive: '#dc2626',
				destructiveForeground: '#ffffff',
				border: '#e2e8f0',
				input: '#e2e8f0',
				ring: '#4f46e5',
			},
		},
	},
	midnight: {
		label: 'Midnight Blue',
		theme: {
			colors: {
				background: '#0c1222',
				foreground: '#e2e8f0',
				card: '#162032',
				cardForeground: '#e2e8f0',
				popover: '#162032',
				popoverForeground: '#e2e8f0',
				primary: '#38bdf8',
				primaryForeground: '#0c1222',
				secondary: '#1e3a5f',
				secondaryForeground: '#e2e8f0',
				muted: '#1e3a5f',
				mutedForeground: '#7dd3fc',
				accent: '#1e3a5f',
				accentForeground: '#e2e8f0',
				destructive: '#f87171',
				destructiveForeground: '#ffffff',
				border: '#1e3a5f',
				input: '#1e3a5f',
				ring: '#38bdf8',
			},
		},
	},
	sepia: {
		label: 'Warm Sepia',
		theme: {
			colors: {
				background: '#faf6f1',
				foreground: '#292524',
				card: '#ffffff',
				cardForeground: '#292524',
				popover: '#ffffff',
				popoverForeground: '#292524',
				primary: '#b45309',
				primaryForeground: '#ffffff',
				secondary: '#f5f0eb',
				secondaryForeground: '#292524',
				muted: '#f5f0eb',
				mutedForeground: '#78716c',
				accent: '#f5f0eb',
				accentForeground: '#292524',
				destructive: '#dc2626',
				destructiveForeground: '#ffffff',
				border: '#d6d3d1',
				input: '#d6d3d1',
				ring: '#b45309',
			},
		},
	},
	vermilionDark: {
		label: 'Vermilion Dark',
		theme: vermilionDarkTheme,
	},
	vermilionLight: {
		label: 'Vermilion Light',
		theme: vermilionLightTheme,
	},
};

// ── Apply theme vars to :root ──────────────────────────────────────────────

function useRootTheme(theme: ViewerTheme) {
	useEffect(() => {
		const vars = themeToCssVars(theme);
		const root = document.documentElement;
		const keys = Object.keys(vars);
		for (const key of keys) {
			root.style.setProperty(key, vars[key]);
		}
		return () => {
			for (const key of keys) {
				root.style.removeProperty(key);
			}
		};
	}, [theme]);
}

// ── App ────────────────────────────────────────────────────────────────────

/**
 * Drop `?sample=1` from the address bar.
 *
 * The docs landing page embeds the demo with `?sample=1` so it opens
 * pre-populated. Once the user opens a deck of their own that param is stale:
 * left in place it would re-seed the bundled sample on the next refresh and
 * throw away what they were looking at.
 */
function dropSampleParam(): void {
	const url = new URL(window.location.href);
	if (!url.searchParams.has('sample')) {
		return;
	}
	url.searchParams.delete('sample');
	window.history.replaceState({}, '', url.toString());
}

function App() {
	const [content, setContent] = useState<Uint8Array | null>(null);
	const [fileName, setFileName] = useState<string>('');
	const viewerRef = useRef<PowerPointViewerHandle>(null);
	const libraryEnabled =
		!isAudienceTab() &&
		!new URLSearchParams(window.location.search).has('room') &&
		!new URLSearchParams(window.location.search).has('broadcast');
	const library = useProjectLibrary(libraryEnabled);
	const [quickGeneration, setQuickGeneration] = useState<{
		project: LocalProject;
		data: Uint8Array;
		settings: QuickVideoSettings;
	} | null>(null);
	const [projectProgress, setProjectProgress] = useState<
		Record<string, ProjectGenerationProgress | undefined>
	>({});
	const advanceProjectProgress = useCallback(
		(projectId: string, next: ProjectGenerationProgress) =>
			setProjectProgress((current) => ({
				...current,
				[projectId]: {
					...next,
					progress: Math.max(current[projectId]?.progress ?? 0, next.progress),
				},
			})),
		[],
	);
	const restoreChecked = library.ready;
	const themeKey = useMemo<string>(() => {
		try {
			return localStorage.getItem('pptx-demo-theme') ?? 'vermilionDark';
		} catch {
			return 'vermilionDark';
		}
	}, []);
	const languageKey = useMemo<string>(() => {
		try {
			return localStorage.getItem('pptx-demo-lang') ?? 'zh-CN';
		} catch {
			return 'zh-CN';
		}
	}, []);

	// ── URL-based collaboration / broadcast join ────────────────────────
	const [urlRoom, setUrlRoom] = useState(() =>
		new URLSearchParams(window.location.search).get('room'),
	);
	const [urlBroadcast, setUrlBroadcast] = useState(() =>
		new URLSearchParams(window.location.search).get('broadcast'),
	);
	// URL params captured once on mount; setters not needed.
	// eslint-disable-next-line react/hook-use-state
	const [urlServer] = useState(
		() => new URLSearchParams(window.location.search).get('server') ?? resolveDefaultServerUrl(),
	);
	// eslint-disable-next-line react/hook-use-state
	const [urlName] = useState(() => new URLSearchParams(window.location.search).get('name'));
	// Serverless peer-to-peer join: `?transport=webrtc` (+ optional
	// `?signaling=a,b`). No server, so no trusted-host check and no file fetch.
	// eslint-disable-next-line react/hook-use-state
	const [urlTransport] = useState(() =>
		new URLSearchParams(window.location.search).get('transport'),
	);
	// eslint-disable-next-line react/hook-use-state
	const [urlSignaling] = useState(() =>
		new URLSearchParams(window.location.search).get('signaling'),
	);
	const isWebrtcJoin = urlTransport === 'webrtc';
	const signalingList = useMemo(() => parseSignaling(urlSignaling), [urlSignaling]);
	// Opt in to the experimental Three.js SmartArt renderer via `?smartArt3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [smartArt3D] = useState(
		() => new URLSearchParams(window.location.search).get('smartArt3D') === '1',
	);
	// Opt in to the experimental Three.js interactive surface-chart renderer
	// (camera orbit/zoom + raycast hover tooltip) via `?surfaceChart3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [surfaceChart3D] = useState(
		() => new URLSearchParams(window.location.search).get('surfaceChart3D') === '1',
	);
	// Opt in to the experimental Three.js interactive bar3D-chart renderer
	// (real box meshes, camera orbit/zoom + raycast hover tooltip) via
	// `?barChart3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [barChart3D] = useState(
		() => new URLSearchParams(window.location.search).get('barChart3D') === '1',
	);
	// Opt in to the experimental Three.js interactive line3D-chart renderer
	// (real tube-path meshes, camera orbit/zoom + raycast hover tooltip) via
	// `?lineChart3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [lineChart3D] = useState(
		() => new URLSearchParams(window.location.search).get('lineChart3D') === '1',
	);
	// Opt in to the experimental Three.js interactive area3D-chart renderer
	// (real tube-path + ribbon meshes, camera orbit/zoom + raycast hover
	// tooltip) via `?areaChart3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [areaChart3D] = useState(
		() => new URLSearchParams(window.location.search).get('areaChart3D') === '1',
	);
	// Opt in to the experimental Three.js interactive pie3D-chart renderer
	// (real wedge meshes, camera orbit/zoom + raycast hover tooltip) via
	// `?pieChart3D=1`.
	// eslint-disable-next-line react/hook-use-state
	const [pieChart3D] = useState(
		() => new URLSearchParams(window.location.search).get('pieChart3D') === '1',
	);
	// `?sample=1` auto-loads the bundled sample deck (used by the docs landing
	// page to embed a live, pre-populated viewer).
	// eslint-disable-next-line react/hook-use-state
	const [urlSample, setUrlSample] = useState(
		() => new URLSearchParams(window.location.search).get('sample') === '1',
	);

	// Generate stable defaults for the Share dialog — these are demo-specific
	const autoRoomId = useMemo(() => {
		const stored = sessionStorage.getItem('pptx-demo-room-id');
		if (stored) {
			return stored;
		}
		const id = `session-${secureRandomToken(8)}`;
		sessionStorage.setItem('pptx-demo-room-id', id);
		return id;
	}, []);

	const autoName = useMemo(() => {
		const ua = navigator.userAgent;
		let platform = 'User';
		if (ua.includes('Win')) {
			platform = 'Windows';
		} else if (ua.includes('Mac')) {
			platform = 'Mac';
		} else if (ua.includes('Linux')) {
			platform = 'Linux';
		}
		const id = secureRandomToken(4);
		return `${platform}-${id}`;
	}, []);

	const defaultServerUrl = resolveDefaultServerUrl();

	// ── AI assistant (demo-only: the host supplies the provider) ─────────
	// Read from localStorage only; the demo ships no key and no config UI.
	const aiConfig = useDemoAiConfig();

	// ── Collaboration ────────────────────────────────────────────────────
	// Auto-connect if room and/or broadcast is in the URL at mount (collaboration
	// / viewer mode respectively; peer-to-peer joins need no server and skip the
	// trusted-host check). Computed once here rather than in an effect that
	// setState's synchronously on every render where it applies: urlRoom /
	// urlBroadcast only ever go from a URL-seeded value to `null` (see
	// handleStopCollaboration below), never the other way, so this can never
	// need to fire again after mount. Room is checked first and broadcast
	// second so that, in the (URL-crafted, not UI-reachable) case where both are
	// present, broadcast wins, preserving this file's previous two-effects
	// ordering where the broadcast effect ran after the room effect.
	const [collaborationConfig, setCollaborationConfig] = useState<CollaborationConfig | null>(() => {
		let config: CollaborationConfig | null = null;
		if (urlRoom) {
			if (isWebrtcJoin) {
				config = {
					roomId: urlRoom,
					serverUrl: '',
					transport: 'webrtc',
					signaling: signalingList,
					userName: urlName ?? autoName,
					userColor: randomCursorColor(),
				};
			} else if (isTrustedServerUrl(urlServer)) {
				config = {
					roomId: urlRoom,
					serverUrl: urlServer,
					userName: urlName ?? autoName,
					userColor: randomCursorColor(),
				};
			} else {
				console.warn(
					`Ignoring ?room= auto-connect because ?server=${urlServer} is not in the trusted-host allowlist. Use the Share dialog to connect explicitly.`,
				);
			}
		}
		if (urlBroadcast) {
			if (isWebrtcJoin) {
				config = {
					roomId: urlBroadcast,
					serverUrl: '',
					transport: 'webrtc',
					signaling: signalingList,
					userName: urlName ?? autoName,
					userColor: randomCursorColor(),
					role: 'viewer',
				};
			} else if (isTrustedServerUrl(urlServer)) {
				config = {
					roomId: urlBroadcast,
					serverUrl: urlServer,
					userName: urlName ?? autoName,
					userColor: randomCursorColor(),
					role: 'viewer',
				};
			} else {
				console.warn(
					`Ignoring ?broadcast= auto-connect because ?server=${urlServer} is not in the trusted-host allowlist.`,
				);
			}
		}
		return config;
	});

	const handleStartCollaboration = useCallback(
		(config: CollaborationConfig) => {
			setCollaborationConfig(config);
			// A broadcast is a one-way session started from the Broadcast dialog
			// (role 'owner', or a `broadcast-` room id); everything else is a
			// two-way collaboration. There is no 'broadcaster' role.
			const isBroadcast = config.role === 'owner' || config.roomId.startsWith('broadcast-');
			const webrtc = isP2PConfig(config);

			// Rewrite the URL so it can be copied to invite others.
			const url = new URL(window.location.href);
			for (const key of ['room', 'broadcast', 'server', 'transport', 'signaling']) {
				url.searchParams.delete(key);
			}
			url.searchParams.set(isBroadcast ? 'broadcast' : 'room', config.roomId);
			if (webrtc) {
				url.searchParams.set('transport', 'webrtc');
				if (config.signaling?.length) {
					url.searchParams.set('signaling', config.signaling.join(','));
				}
			} else {
				url.searchParams.set('server', config.serverUrl);
			}
			window.history.replaceState({}, '', url.toString());

			if (content && config.sessionIntent !== 'join') {
				// P2P has no file server, so stash the deck in IndexedDB for
				// same-browser joiner tabs to pick up (the Y.Doc still syncs edits).
				void storeAudienceContent(content).catch(() => {
					/* IndexedDB unavailable: joiners fall back to Y.Doc sync */
				});
				// A trusted y-websocket relay can also host the file for other devices.
				// Restricted to trusted hosts so a crafted ?server= cannot exfiltrate.
				if (!webrtc && isTrustedServerUrl(config.serverUrl)) {
					const httpUrl = config.serverUrl.replace(/^ws/u, 'http');
					// Copy into a fresh Uint8Array so TS sees a BodyInit-compatible
					// Uint8Array<ArrayBuffer> (the source may be ArrayBufferLike-backed).
					void fetch(`${httpUrl}/file/${encodeURIComponent(config.roomId)}`, {
						method: 'POST',
						body: new Uint8Array(content),
					}).catch(() => {
						/* server may not support file storage: fall back silently */
					});
				}
			}
		},
		[content],
	);

	const handleStopCollaboration = useCallback(() => {
		setCollaborationConfig(null);
		setUrlRoom(null);
		setUrlBroadcast(null);
		// Remove room/broadcast from URL
		const url = new URL(window.location.href);
		for (const key of ['room', 'broadcast', 'server', 'transport', 'signaling', 'name']) {
			url.searchParams.delete(key);
		}
		window.history.replaceState({}, '', url.toString());
	}, []);

	// Auto-load the bundled sample deck when `?sample=1` is present. Runs before
	// the blank-deck collab bootstrap below (local fetch beats its 1.5s timer),
	// so a `?sample=1&room=…` host pane seeds the session with the sample, and
	// AFTER the restore check below: a tab that already has a deck of its own
	// must not have the sample dropped back on top of it.
	useEffect(() => {
		if (!urlSample || content || !restoreChecked) {
			return;
		}
		let cancelled = false;
		void fetch(`${import.meta.env.BASE_URL}sample-deck.pptx`)
			.then((res) => {
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}
				return res.arrayBuffer();
			})
			.then((buf) => {
				if (!cancelled) {
					setContent(new Uint8Array(buf));
					setFileName('sample-deck.pptx');
				}
				return undefined;
			})
			.catch(() => {
				// Sample not available: fall through to the regular dropzone.
			});
		return () => {
			cancelled = true;
		};
	}, [urlSample, content, restoreChecked]);

	// When joining via URL with a room/broadcast param, download PPTX from the
	// collab server — but ONLY if the server is in the trusted-host allowlist.
	// Otherwise a crafted URL could trick the demo into ingesting attacker bytes.
	const joinRoomId = urlRoom ?? urlBroadcast;
	useEffect(() => {
		if (!joinRoomId || content) {
			return;
		}
		// Peer-to-peer join: there is no file server. The viewer is bootstrapped
		// below (IndexedDB or a blank deck) and the Y.Doc late-joiner sync fills
		// in the host's slides.
		if (isWebrtcJoin) {
			return;
		}
		if (!isTrustedServerUrl(urlServer)) {
			console.warn(
				`Refusing to fetch presentation from untrusted ?server=${urlServer}. Add the host to TRUSTED_COLLAB_HOSTS or use the Share dialog.`,
			);
			return;
		}
		let cancelled = false;
		const httpUrl = urlServer.replace(/^ws/u, 'http');
		void fetch(`${httpUrl}/file/${encodeURIComponent(joinRoomId)}`)
			.then((res) => {
				if (!res.ok) {
					throw new Error('Not found');
				}
				return res.arrayBuffer();
			})
			.then((buf) => {
				if (cancelled) {
					return undefined;
				}
				setContent(new Uint8Array(buf));
				setFileName(urlBroadcast ? 'Broadcast Session' : 'Collaboration Session');
				return undefined;
			})
			.catch(() => {
				// File not available on server — user will need to load manually
			});
		return () => {
			cancelled = true;
		};
	}, [joinRoomId, urlServer, content, urlBroadcast, isWebrtcJoin]);

	// Fallback: try IndexedDB (same-browser tabs).
	// A `?sample=1` host seeds the session from the bundled deck instead, so
	// never race it with the IndexedDB / blank-deck fallbacks.
	useEffect(() => {
		if (!joinRoomId || content || urlSample) {
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			void loadAudienceContent().then((bytes) => {
				if (cancelled || !bytes) {
					return undefined;
				}
				setContent(bytes);
				setFileName(urlBroadcast ? 'Broadcast Session' : 'Collaboration Session');
				return undefined;
			});
		}, 1500);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [joinRoomId, content, urlBroadcast, urlSample]);

	// Serverless webrtc joins have no file server and no IndexedDB seed:
	// bootstrap a blank deck immediately (no delay) so the viewer (and its
	// webrtc provider) mount right away; the Y.Doc late-joiner sync then
	// replaces the blank deck with the host's real slides.
	useEffect(() => {
		if (!isWebrtcJoin || !joinRoomId || content || urlSample) {
			return;
		}
		let cancelled = false;
		void PptxHandler.createBlank({ title: 'Collaboration Session', initialSlideCount: 1 })
			.then(({ handler, data }) => handler.save(data.slides))
			.then((blank) => {
				if (cancelled) {
					return undefined;
				}
				setContent(blank);
				setFileName(urlBroadcast ? 'Broadcast Session' : 'Collaboration Session');
				return undefined;
			});
		return () => {
			cancelled = true;
		};
	}, [isWebrtcJoin, joinRoomId, content, urlBroadcast, urlSample]);

	// When opened as an audience tab, load the PPTX content from IndexedDB
	useEffect(() => {
		if (!isAudienceTab()) {
			return;
		}
		let cancelled = false;
		void loadAudienceContent(parseAudienceNonce() ?? undefined).then((bytes) => {
			if (cancelled || !bytes) {
				return undefined;
			}
			setContent(bytes);
			setFileName('Audience View');
			return undefined;
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Session bytes remain a fallback for older hosts; the library owns navigation.
	useEffect(() => {
		if (!content || isAudienceTab()) {
			return;
		}
		void rememberSessionDeck(library.active?.autosaveKey ?? fileName, content);
	}, [content, fileName, library.active?.autosaveKey]);

	const returnToProjects = () =>
		void library.run(async () => {
			if (!viewerRef.current) {
				throw new Error('编辑器尚未就绪，请稍后重试。');
			}
			const bytes = await viewerRef.current.getContent();
			await library.save(fileName, bytes);
			setUrlSample(false);
			dropSampleParam();
			setContent(null);
			library.setActive(null);
			document.title = '我的项目 - PPTX Viewer';
		});

	const openProject = (id: string) =>
		void library.run(async () => {
			const { metadata, data } = await library.open(id);
			setUrlSample(false);
			dropSampleParam();
			setFileName(metadata.name);
			setContent(data);
		});

	const generateProjectVideo = (project: LocalProject, settings: QuickVideoSettings) =>
		void library.run(async () => {
			try {
				setProjectProgress((current) => ({
					...current,
					[project.id]: { stage: 'configuring', progress: 1, status: '正在应用生成设置' },
				}));
				const ttsResponse = await fetch('/api/storyboard/tts/config', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ provider: settings.ttsProvider }),
				});
				if (!ttsResponse.ok) {
					const result = (await ttsResponse.json().catch(() => ({}))) as { error?: string };
					throw new Error(result.error || `语音服务配置失败（HTTP ${ttsResponse.status}）`);
				}
				advanceProjectProgress(project.id, {
					stage: 'loading',
					progress: 1,
					status: '正在读取项目文件',
				});
				const loaded = await library.load(project.id);
				setQuickGeneration({ project: loaded.metadata, data: loaded.data, settings });
				advanceProjectProgress(project.id, {
					stage: 'parsing',
					progress: 2,
					status: '正在解析演示文稿',
				});
			} catch (error) {
				advanceProjectProgress(project.id, {
					stage: 'failed',
					progress: 0,
					status: error instanceof Error ? error.message : '生成设置应用失败',
					terminal: true,
				});
				throw error;
			}
		});

	const deleteProject = (project: LocalProject) => {
		if (!window.confirm(`确定删除“${project.name}”吗？删除后无法恢复。`)) {
			return;
		}
		void library.run(() => library.remove(project));
	};

	// Update document title when in collaboration/broadcast mode
	useEffect(() => {
		if (collaborationConfig && content) {
			const isBroadcast =
				collaborationConfig.role === 'owner' || collaborationConfig.roomId.startsWith('broadcast-');
			const prefix = isBroadcast
				? '[Broadcasting]'
				: collaborationConfig.role === 'viewer'
					? '[Watching]'
					: '[Collab]';
			document.title = `${prefix} ${fileName} - PPTX Viewer`;
		}
	}, [collaborationConfig, content, fileName]);

	const currentPreset = themes[themeKey] ?? themes.vermilionDark;

	// Apply theme CSS vars to :root so Tailwind's @theme var() references resolve
	useRootTheme(currentPreset.theme);

	const { t } = useTranslation();

	useEffect(() => {
		void i18nInstance.changeLanguage(languageKey);
	}, [languageKey]);

	const { run: runLibrary, create: createLibrary } = library;
	const handleFile = useCallback(
		(file: File) =>
			void runLibrary(async () => {
				setUrlSample(false);
				dropSampleParam();
				const bytes = new Uint8Array(await file.arrayBuffer());
				await createLibrary(file.name, bytes);
				setFileName(file.name);
				setContent(bytes);
			}),
		[runLibrary, createLibrary],
	);

	const handleNewPresentation = () =>
		library.run(async () => {
			setUrlSample(false);
			dropSampleParam();
			const { handler, data } = await PptxHandler.createBlank({
				title: '未命名演示文稿',
				initialSlideCount: 1,
			});
			const bytes = await handler.save(data.slides);
			await library.create('未命名演示文稿.pptx', bytes);
			setContent(bytes);
			setFileName('未命名演示文稿.pptx');
		});

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) {
				handleFile(file);
			}
		},
		[handleFile],
	);

	const fileInputRef = useRef<HTMLInputElement>(null);

	/** Open the native picker from the explicit Browse control. */
	const openFilePicker = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	/**
	 * The dashed zone paints `cursor: pointer` over its whole area and the copy
	 * says "click to browse", so the whole area has to open the picker, not just
	 * the one text line that happens to be a <label>. Clicks that originate on a
	 * button, on the label, or on the input itself are already handled by those
	 * elements; re-opening from here would double-fire or loop.
	 */
	const handleZoneClick = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			if ((e.target as HTMLElement).closest('button, label[for="file-input"], #file-input')) {
				return;
			}
			openFilePicker();
		},
		[openFilePicker],
	);

	if (content) {
		return (
			<main className='h-[100dvh] w-screen flex flex-col'>
				{libraryEnabled && (
					<div className='flex shrink-0 items-center gap-4 border-b border-border bg-background text-foreground px-4 py-2 text-sm'>
						<button
							type='button'
							disabled={library.busy}
							onClick={returnToProjects}
							className='rounded-md border border-border px-3 py-1 hover:bg-accent disabled:opacity-50'
						>
							{library.busy ? '正在保存…' : '← 返回项目列表'}
						</button>
						<span className='truncate'>{fileName}</span>
						{library.error && (
							<span role='alert' className='text-red-500'>
								{library.error}
							</span>
						)}
					</div>
				)}
				<div className='min-h-0 flex-1'>
					{/* `autosaveIntervalMs`: a demo wants snappy crash recovery, and an
				    explicit interval is a host policy that outranks the File > Options
				    AutoRecover cadence the viewer otherwise follows (2 minutes). */}
					<PowerPointViewer
						ref={viewerRef}
						key={library.active?.id ?? fileName}
						content={content}
						fileName={fileName}
						filePath={library.active?.autosaveKey ?? fileName}
						canEdit
						autosaveIntervalMs={2000}
						smartArt3D={smartArt3D}
						surfaceChart3D={surfaceChart3D}
						barChart3D={barChart3D}
						lineChart3D={lineChart3D}
						areaChart3D={areaChart3D}
						pieChart3D={pieChart3D}
						authorName={collaborationConfig?.userName ?? autoName}
						collaboration={collaborationConfig ?? undefined}
						onStartCollaboration={handleStartCollaboration}
						onStopCollaboration={handleStopCollaboration}
						shareDefaults={{
							roomId: autoRoomId,
							userName: autoName,
							serverUrl: defaultServerUrl,
						}}
						ai={aiConfig}
						storyboardScriptEndpoint='/api/storyboard/generate'
						storyboardTtsEndpoint='/api/storyboard/tts'
						storyboardJobEndpoint='/api/storyboard/jobs'
						storyboardProjectKey={library.active?.storyboardKey}
						onOpenFile={libraryEnabled ? returnToProjects : undefined}
						onDirtyChange={(dirty) => {
							document.title = dirty ? `* ${fileName} - PPTX Viewer` : `${fileName} - PPTX Viewer`;
						}}
					/>
				</div>
			</main>
		);
	}

	return (
		<main className='flex flex-col items-center min-h-[100dvh] w-screen bg-background text-foreground px-6 py-10'>
			{library.error && (
				<p role='alert' className='mb-4 text-red-500 max-w-[900px] w-full'>
					{library.error}
				</p>
			)}
			<PresentationDropzone
				label={t('demo.dropzone.uploadAriaLabel')}
				disabled={library.busy || !library.ready}
				onClick={handleZoneClick}
				onFile={handleFile}
			>
				{urlBroadcast ? (
					<>
						<p className='text-foreground mb-2 font-medium'>
							{t('demo.dropzone.joiningBroadcast')}{' '}
							<code className='px-1.5 py-0.5 rounded bg-muted text-primary text-sm font-mono'>
								{urlBroadcast}
							</code>
						</p>
						<p className='text-muted-foreground mb-3'>{t('demo.dropzone.loadingBroadcast')}</p>
					</>
				) : urlRoom ? (
					<>
						<p className='text-foreground mb-2 font-medium'>
							{t('demo.dropzone.joiningSession')}{' '}
							<code className='px-1.5 py-0.5 rounded bg-muted text-primary text-sm font-mono'>
								{urlRoom}
							</code>
						</p>
						<label className='text-muted-foreground mb-3 cursor-pointer' htmlFor='file-input'>
							{t('demo.dropzone.hintCollab')}
						</label>
					</>
				) : (
					<label className='text-muted-foreground mb-3 cursor-pointer' htmlFor='file-input'>
						{t('demo.dropzone.hint')}
					</label>
				)}
				<p className='text-sm text-muted-foreground'>{t('demo.dropzone.processed')}</p>
				<div className='mt-4 flex flex-wrap items-center justify-center gap-2'>
					<button
						type='button'
						data-testid='browse-files'
						disabled={library.busy || !library.ready}
						onClick={(e) => {
							e.stopPropagation();
							openFilePicker();
						}}
						className='px-4 py-2 rounded-lg border border-primary bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium transition-opacity'
					>
						{t('demo.dropzone.browse')}
					</button>
					<button
						type='button'
						disabled={library.busy || !library.ready}
						onClick={(e) => {
							e.stopPropagation();
							void handleNewPresentation();
						}}
						className='px-4 py-2 rounded-lg border border-border bg-muted hover:bg-accent text-foreground text-sm transition-colors'
					>
						{t('demo.dropzone.newPresentation')}
					</button>
				</div>
				<input
					type='file'
					id='file-input'
					disabled={library.busy || !library.ready}
					accept={PPTX_OPEN_ACCEPT}
					aria-label={t('demo.dropzone.uploadAriaLabel')}
					className='sr-only'
					ref={fileInputRef}
					onChange={handleInputChange}
				/>
			</PresentationDropzone>
			{libraryEnabled && <TtsProviderSettings />}
			{libraryEnabled && (
				<ProjectLibrary
					projects={library.projects}
					ready={library.ready}
					busy={library.busy || Boolean(quickGeneration)}
					onOpen={openProject}
					onGenerate={generateProjectVideo}
					onDelete={deleteProject}
					progressByProject={projectProgress}
					loadPreview={library.load}
				/>
			)}
			{quickGeneration && (
				<div
					className='fixed -left-[12000px] top-0 h-[720px] w-[1280px] overflow-hidden [transform:translateZ(0)]'
					aria-hidden='true'
				>
					<PowerPointViewer
						key={`quick-video-${quickGeneration.project.id}`}
						content={quickGeneration.data}
						fileName={quickGeneration.project.name}
						filePath={quickGeneration.project.autosaveKey}
						storyboardScriptEndpoint='/api/storyboard/generate'
						storyboardTtsEndpoint='/api/storyboard/tts'
						storyboardJobEndpoint='/api/storyboard/jobs'
						storyboardProjectKey={quickGeneration.project.storyboardKey}
						storyboardAutoGenerate
						storyboardAutoGenerateOptions={{
							polish: quickGeneration.settings.polish,
							subtitlesEnabled: quickGeneration.settings.subtitlesEnabled,
							audience: quickGeneration.settings.audience,
							detail: quickGeneration.settings.detail,
							supplement: quickGeneration.settings.supplement,
						}}
						onStoryboardGenerationProgress={(progress) => {
							const projectId = quickGeneration.project.id;
							advanceProjectProgress(projectId, progress);
							if (progress.terminal) {
								setQuickGeneration(null);
							}
						}}
					/>
				</div>
			)}
		</main>
	);
}

const rootEl = document.getElementById('app-root');
if (rootEl) {
	createRoot(rootEl).render(<App />);
}
