import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

import JSZip from 'jszip';
import type { Connect } from 'vite';

import { acceptsContentType } from '../request-security';
import { cancelRunningStoryboardJob } from './job-runner';
import type { StoryboardSynthesizer } from './job-runner';
import { canEnqueueStoryboardJob, enqueueStoryboardJob } from './job-scheduler';
import {
	createStoryboardJob,
	discardStoryboardJob,
	getStoryboardJob,
	requestStoryboardJobCancel,
	snapshotStoryboardJob,
	updateStoryboardJob,
} from './job-store';
import type { StoryboardJobManifest } from './job-types';
import { sendMediaFile } from './media-response';

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_SHOTS = 500;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_DURATION_MS = 4 * 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 1024 * 1024;

function sendJson(
	response: import('node:http').ServerResponse,
	status: number,
	body: unknown,
): void {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json; charset=utf-8');
	response.end(JSON.stringify(body));
}

async function readLimited(request: import('node:http').IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_UPLOAD_BYTES) {
			throw new Error('UPLOAD_TOO_LARGE');
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function safeEntryPath(name: string): string {
	const value = normalize(name).replaceAll('\\', '/');
	if (value.startsWith('../') || value.startsWith('/') || value.includes('/../')) {
		throw new Error('INVALID_ARCHIVE_PATH');
	}
	return value;
}

function declaredUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
	return (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data
		?.uncompressedSize;
}

function isSafePng(bytes: Buffer): boolean {
	if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
		return false;
	}
	if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
		return false;
	}
	const width = bytes.readUInt32BE(16);
	const height = bytes.readUInt32BE(20);
	return width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 33_554_432;
}

function parseManifest(value: unknown): StoryboardJobManifest {
	const manifest = value as Partial<StoryboardJobManifest>;
	if (manifest.version !== 1 || !Array.isArray(manifest.shots) || manifest.shots.length === 0) {
		throw new Error('INVALID_MANIFEST');
	}
	if (!Array.isArray(manifest.narrationClips) || manifest.narrationClips.length > MAX_SHOTS * 2) {
		throw new Error('INVALID_NARRATION_CLIPS');
	}
	if (manifest.shots.length > MAX_SHOTS) {
		throw new Error('TOO_MANY_SHOTS');
	}
	const width = Number(manifest.width);
	const height = Number(manifest.height);
	if (
		![width, height].every((number) => Number.isFinite(number) && number >= 240 && number <= 3840)
	) {
		throw new Error('INVALID_DIMENSIONS');
	}
	if (!Number.isSafeInteger(manifest.fps) || manifest.fps < 15 || manifest.fps > 60) {
		throw new Error('INVALID_FPS');
	}
	let totalDurationMs = 0;
	let totalScriptChars = 0;
	const frameFiles = new Set<string>();
	for (const shot of manifest.shots) {
		if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(shot.id)) {
			throw new Error('INVALID_SHOT_ID');
		}
		if (
			!Number.isFinite(shot.durationMs) ||
			shot.durationMs < 100 ||
			shot.durationMs > 30 * 60 * 1000
		) {
			throw new Error('INVALID_SHOT_DURATION');
		}
		if (typeof shot.script !== 'string' || shot.script.length > 4000) {
			throw new Error('INVALID_SCRIPT');
		}
		if (!Number.isSafeInteger(shot.startFrame) || shot.startFrame < 0) {
			throw new Error('INVALID_START_FRAME');
		}
		if (!Number.isSafeInteger(shot.frameCount) || shot.frameCount < 1) {
			throw new Error('INVALID_FRAME_COUNT');
		}
		const frameFile = safeEntryPath(shot.frameFile);
		if (!/^frames\/\d{5}\.png$/u.test(frameFile) || frameFiles.has(frameFile)) {
			throw new Error('INVALID_FRAME_FILE');
		}
		frameFiles.add(frameFile);
		if (shot.frameCount > Math.ceil((shot.durationMs / 1000) * manifest.fps) + 1) {
			throw new Error('FRAME_COUNT_MISMATCH');
		}
		if (shot.previousFrameFile) {
			safeEntryPath(shot.previousFrameFile);
		}
		if (
			shot.transitionMs !== undefined &&
			(!Number.isFinite(shot.transitionMs) || shot.transitionMs < 0 || shot.transitionMs > 5000)
		) {
			throw new Error('INVALID_TRANSITION_DURATION');
		}
		totalDurationMs += shot.durationMs;
		totalScriptChars += shot.script.length;
	}
	if (totalDurationMs > MAX_TOTAL_DURATION_MS) {
		throw new Error('VIDEO_TOO_LONG');
	}
	if (totalScriptChars > 500_000) {
		throw new Error('SCRIPT_TOTAL_TOO_LARGE');
	}
	for (const clip of manifest.narrationClips) {
		if (!/^[a-zA-Z0-9_-]{1,200}$/u.test(clip.id)) {
			throw new Error('INVALID_NARRATION_ID');
		}
		if (!manifest.shots.some((shot) => shot.id === clip.sourceShotId)) {
			throw new Error('INVALID_NARRATION_SOURCE');
		}
		if (
			!Number.isFinite(clip.startMs) ||
			clip.startMs < 0 ||
			clip.startMs > MAX_TOTAL_DURATION_MS
		) {
			throw new Error('INVALID_NARRATION_START');
		}
		if (typeof clip.script !== 'string' || clip.script.length > 4000) {
			throw new Error('INVALID_SCRIPT');
		}
		totalScriptChars += clip.script.length;
		if (!Number.isSafeInteger(clip.startSample) || clip.startSample < 0) {
			throw new Error('INVALID_START_SAMPLE');
		}
	}
	if (totalScriptChars > 500_000) {
		throw new Error('SCRIPT_TOTAL_TOO_LARGE');
	}
	return manifest as StoryboardJobManifest;
}

async function unpackJob(jobDir: string, body: Buffer): Promise<StoryboardJobManifest> {
	const archive = await JSZip.loadAsync(body);
	if (Object.keys(archive.files).length > MAX_SHOTS + 10) {
		throw new Error('TOO_MANY_ARCHIVE_ENTRIES');
	}
	const manifestFile = archive.file('manifest.json');
	if (!manifestFile) {
		throw new Error('MISSING_MANIFEST');
	}
	if ((declaredUncompressedSize(manifestFile) ?? 0) > MAX_MANIFEST_BYTES) {
		throw new Error('MANIFEST_TOO_LARGE');
	}
	const manifestText = await manifestFile.async('string');
	if (Buffer.byteLength(manifestText, 'utf8') > MAX_MANIFEST_BYTES) {
		throw new Error('MANIFEST_TOO_LARGE');
	}
	const manifest = parseManifest(JSON.parse(manifestText));
	let expandedBytes = 0;
	for (const shot of manifest.shots) {
		const entryName = safeEntryPath(shot.frameFile);
		shot.frameFile = entryName;
		const entry = archive.file(entryName);
		if (!entry) {
			throw new Error(`MISSING_FRAME:${entryName}`);
		}
		if ((declaredUncompressedSize(entry) ?? 0) > MAX_FRAME_BYTES) {
			throw new Error('FRAME_TOO_LARGE');
		}
		const bytes = await entry.async('nodebuffer');
		if (bytes.length > MAX_FRAME_BYTES) {
			throw new Error('FRAME_TOO_LARGE');
		}
		if (!isSafePng(bytes)) {
			throw new Error('INVALID_FRAME_IMAGE');
		}
		expandedBytes += bytes.length;
		if (expandedBytes > MAX_EXPANDED_BYTES) {
			throw new Error('ARCHIVE_EXPANDED_TOO_LARGE');
		}
		const outputPath = join(jobDir, entryName);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, bytes, { mode: 0o600 });
	}
	await writeFile(join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
	return manifest;
}

export function createStoryboardJobMiddleware(
	synthesizer: StoryboardSynthesizer,
): Connect.NextHandleFunction {
	return async (request, response) => {
		const pathname = new URL(request.url || '/', 'http://localhost').pathname;
		if (request.method === 'POST' && pathname === '/') {
			if (!acceptsContentType(request, 'application/zip')) {
				return sendJson(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
			}
			let job: Awaited<ReturnType<typeof createStoryboardJob>> | undefined;
			try {
				if (!canEnqueueStoryboardJob()) {
					return sendJson(response, 429, { error: 'JOB_QUEUE_FULL' });
				}
				job = await createStoryboardJob();
				updateStoryboardJob(job, { stage: 'preparing', progress: 1 });
				const manifest = await unpackJob(job.workDir, await readLimited(request));
				enqueueStoryboardJob(job, manifest, synthesizer);
				return sendJson(response, 202, {
					...snapshotStoryboardJob(job),
					jobToken: job.accessToken,
				});
			} catch (error) {
				if (job) {
					await discardStoryboardJob(job);
				}
				const code =
					error instanceof Error && /^[A-Z_]+(?::[a-zA-Z0-9_./-]+)?$/u.test(error.message)
						? error.message
						: 'INVALID_JOB_ARCHIVE';
				return sendJson(response, 400, { error: code });
			}
		}
		const match = pathname.match(/^\/([0-9a-f-]+)(?:\/(video|subtitle|cancel))?$/u);
		if (!match) {
			return sendJson(response, 404, { error: 'NOT_FOUND' });
		}
		const job = await getStoryboardJob(match[1]);
		if (!job) {
			return sendJson(response, 404, { error: 'JOB_NOT_FOUND' });
		}
		if (request.headers['x-storyboard-job-token'] !== job.accessToken) {
			return sendJson(response, 403, { error: 'JOB_ACCESS_DENIED' });
		}
		if (request.method === 'POST' && match[2] === 'cancel') {
			if (['completed', 'failed', 'cancelled'].includes(job.stage)) {
				return sendJson(response, 409, { error: 'JOB_ALREADY_FINISHED' });
			}
			requestStoryboardJobCancel(job);
			cancelRunningStoryboardJob(job.id);
			return sendJson(response, 202, snapshotStoryboardJob(job));
		}
		if (request.method === 'GET' && match[2] === 'video') {
			if (job.stage !== 'completed' || !job.outputPath) {
				return sendJson(response, 409, { error: 'VIDEO_NOT_READY' });
			}
			return sendMediaFile(request, response, job.outputPath, 'video/mp4');
		}
		if (request.method === 'GET' && match[2] === 'subtitle') {
			if (job.stage !== 'completed' || !job.subtitlePath) {
				return sendJson(response, 409, { error: 'SUBTITLE_NOT_READY' });
			}
			return sendMediaFile(
				request,
				response,
				job.subtitlePath,
				'application/x-subrip; charset=utf-8',
			);
		}
		if (request.method === 'GET' && !match[2]) {
			return sendJson(response, 200, snapshotStoryboardJob(job));
		}
		return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
	};
}
