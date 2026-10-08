import path from 'path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { buildStamp } from '../build-stamp';
import { accessPassword } from './access-password';
import { storyboardApi } from './storyboard-api';

export default defineConfig({
	root: __dirname,
	// Served from the repo root locally ("/"), but under "/pptx-viewer/demo/" when
	// deployed to GitHub Pages. CI sets DEMO_BASE to the subpath.
	base: process.env.DEMO_BASE ?? '/',
	plugins: [
		accessPassword(),
		react(),
		tailwindcss(),
		buildStamp(path.resolve(__dirname, '../../packages/react/package.json')),
		storyboardApi(),
	],
	server: {
		port: 4173,
		open: true,
	},
	build: {
		chunkSizeWarningLimit: 2500,
	},
	resolve: {
		alias: {
			'pptx-viewer-shared/theme': path.resolve(
				__dirname,
				'../../packages/shared/src/theme/index.ts',
			),
			'pptx-viewer-shared/loader': path.resolve(
				__dirname,
				'../../packages/shared/src/loader/index.ts',
			),
			'pptx-viewer-shared/smartart-3d': path.resolve(
				__dirname,
				'../../packages/shared/src/smartart-3d/index.ts',
			),
			'pptx-viewer-shared/i18n': path.resolve(__dirname, '../../packages/shared/src/i18n/index.ts'),
			'pptx-viewer-shared/ai': path.resolve(__dirname, '../../packages/shared/src/ai/index.ts'),
			'pptx-viewer-shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
			'pptx-viewer-mcp/schemas': path.resolve(
				__dirname,
				'../../packages/tools/src/schemas/index.ts',
			),
			'pptx-viewer-mcp/codec': path.resolve(__dirname, '../../packages/tools/src/codec/index.ts'),
			'pptx-viewer-mcp': path.resolve(__dirname, '../../packages/tools/src/index.ts'),
			'pptx-viewer-core/converter': path.resolve(
				__dirname,
				'../../packages/core/src/converter/index.ts',
			),
			'pptx-viewer-core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
			'pptx-viewer-locales': path.resolve(__dirname, '../../packages/locales/src/index.ts'),
			'pptx-react-viewer/i18n': path.resolve(__dirname, '../../packages/react/src/i18n.ts'),
			'pptx-react-viewer': path.resolve(__dirname, '../../packages/react/src/index.ts'),
		},
	},
});
