import { chmod, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SynthesizedShotAudio } from '../../render/video-renderer';
import type { StoryboardSynthesizer, StoryboardSynthesisInput } from '../job-runner';
import { NeuralTtsError } from './errors';
import { runBoundedProcess } from './process';
import type { ProcessInvocation } from './process';
import { pcmWavDurationMs } from './wav';

interface Boundary {
	text: string;
	startMs: number;
	endMs: number;
}

export interface EdgeTtsSynthesizerOptions {
	voice?: string;
	pitch?: string;
	timeoutMs?: number;
	maxRetries?: number;
	keepSourceMp3?: boolean;
	bridgeInvocation?: (bridgePath: string) => ProcessInvocation;
}

const bridgePath = fileURLToPath(new URL('./edge-tts-bridge.py', import.meta.url));

function defaultBridgeInvocation(path: string): ProcessInvocation {
	const configured = process.env.STORYBOARD_EDGE_TTS_COMMAND?.trim();
	if (configured) {
		return { command: configured, args: [path] };
	}
	return { command: 'uvx', args: ['--from', 'edge-tts', 'python', path] };
}

function safeId(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9_-]/gu, '_');
}

function edgeRate(speed: number): string {
	const percent = Math.round(Math.max(-50, Math.min(100, speed * 10)));
	return `${percent >= 0 ? '+' : ''}${percent}%`;
}

async function retryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('Cancelled', 'AbortError'));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, delayMs);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function parseBoundaries(raw: string, durationMs: number): Boundary[] {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS 词边界 JSON 无法解析。', error);
	}
	if (!Array.isArray(value)) {
		throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS 未返回词边界数组。');
	}
	return value.map((item, index) => {
		const boundary = item as Partial<Boundary>;
		const startMs = Math.max(0, Math.round(Number(boundary.startMs)));
		const endMs = Math.min(durationMs, Math.round(Number(boundary.endMs)));
		if (!boundary.text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
			throw new NeuralTtsError(
				'EDGE_TTS_OUTPUT_INVALID',
				`Edge TTS 第 ${index + 1} 个词边界无效。`,
			);
		}
		return { text: boundary.text, startMs, endMs };
	});
}

export class EdgeTtsStoryboardSynthesizer implements StoryboardSynthesizer {
	readonly providerName = 'edge-tts';
	readonly options: Required<Omit<EdgeTtsSynthesizerOptions, 'bridgeInvocation'>> &
		Pick<EdgeTtsSynthesizerOptions, 'bridgeInvocation'>;

	constructor(options: EdgeTtsSynthesizerOptions = {}) {
		this.options = {
			voice:
				options.voice ?? process.env.STORYBOARD_EDGE_TTS_VOICE?.trim() ?? 'zh-CN-XiaoxiaoNeural',
			pitch: options.pitch ?? process.env.STORYBOARD_EDGE_TTS_PITCH?.trim() ?? '+0Hz',
			timeoutMs: options.timeoutMs ?? 60_000,
			maxRetries: options.maxRetries ?? 2,
			keepSourceMp3: options.keepSourceMp3 ?? false,
			bridgeInvocation: options.bridgeInvocation,
		};
	}

	async synthesize(input: StoryboardSynthesisInput): Promise<SynthesizedShotAudio> {
		if (input.signal.aborted) {
			throw new DOMException('Cancelled', 'AbortError');
		}
		const stem = `audio-${safeId(input.clipId)}`;
		const mp3Path = join(input.outputDir, `${stem}.edge.mp3`);
		const boundariesPath = join(input.outputDir, `${stem}.boundaries.json`);
		const wavPath = join(input.outputDir, `${stem}.wav`);
		let completed = false;
		try {
			await Promise.all([
				rm(mp3Path, { force: true }),
				rm(boundariesPath, { force: true }),
				rm(wavPath, { force: true }),
			]);
			for (let attempt = 0; ; attempt += 1) {
				const invocation = (this.options.bridgeInvocation ?? defaultBridgeInvocation)(bridgePath);
				try {
					await runBoundedProcess(
						{
							...invocation,
							args: [
								...invocation.args,
								'--text',
								input.text,
								'--voice',
								this.options.voice,
								'--rate',
								edgeRate(input.speed),
								'--pitch',
								this.options.pitch,
								'--media',
								mp3Path,
								'--boundaries',
								boundariesPath,
							],
						},
						{ signal: input.signal, timeoutMs: this.options.timeoutMs },
					);
					break;
				} catch (error) {
					const retryable =
						error instanceof NeuralTtsError &&
						['EDGE_TTS_NETWORK_FAILED', 'EDGE_TTS_PROCESS_FAILED'].includes(error.code);
					if (!retryable || attempt >= this.options.maxRetries) {
						throw error;
					}
					await Promise.all([rm(mp3Path, { force: true }), rm(boundariesPath, { force: true })]);
					await retryDelay(250 * 2 ** attempt, input.signal);
				}
			}
			await runBoundedProcess(
				{
					command: 'ffmpeg',
					args: [
						'-y',
						'-v',
						'error',
						'-i',
						mp3Path,
						'-ac',
						'1',
						'-ar',
						'24000',
						'-c:a',
						'pcm_s16le',
						wavPath,
					],
				},
				{ signal: input.signal, timeoutMs: Math.min(this.options.timeoutMs, 30_000) },
			);
			let wav: Buffer;
			let boundariesJson: string;
			try {
				[wav, boundariesJson] = await Promise.all([
					readFile(wavPath),
					readFile(boundariesPath, 'utf8'),
				]);
			} catch (error) {
				throw new NeuralTtsError(
					'EDGE_TTS_OUTPUT_INVALID',
					'Edge TTS 未生成完整的 WAV 或词边界文件。',
					error,
				);
			}
			const durationMs = pcmWavDurationMs(wav);
			const words = parseBoundaries(boundariesJson, durationMs);
			if (words.length === 0) {
				throw new NeuralTtsError('EDGE_TTS_OUTPUT_INVALID', 'Edge TTS 未返回可用词边界。');
			}
			await chmod(wavPath, 0o600);
			completed = true;
			return {
				clipId: input.clipId,
				sourceShotId: input.sourceShotId,
				startMs: input.startMs,
				startSample: input.startSample,
				audioPath: wavPath,
				durationMs,
				words,
			};
		} finally {
			await rm(boundariesPath, { force: true });
			if (!this.options.keepSourceMp3) {
				await rm(mp3Path, { force: true });
			}
			if (!completed) {
				await rm(wavPath, { force: true });
			}
		}
	}
}
