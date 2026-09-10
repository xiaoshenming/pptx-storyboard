import { spawn } from 'node:child_process';

import { NeuralTtsError } from './errors';

export interface ProcessInvocation {
	command: string;
	args: string[];
}

function classifyFailure(command: string, stderr: string, cause?: unknown): NeuralTtsError {
	const detail = stderr.trim().slice(-1200);
	if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
		const requirement =
			command === 'ffmpeg'
				? '最终 WAV 转码需要安装 ffmpeg。'
				: '合成需要安装 uv/uvx，或配置已安装 edge-tts 的 Python。';
		return new NeuralTtsError(
			'EDGE_TTS_DEPENDENCY_MISSING',
			`找不到 ${command}；${requirement}`,
			cause,
		);
	}
	if (/no module named ['"]?edge_tts|distribution .*edge-tts.*not found/iu.test(detail)) {
		return new NeuralTtsError(
			'EDGE_TTS_DEPENDENCY_MISSING',
			`Python 环境缺少 edge-tts：${detail}`,
			cause,
		);
	}
	if (/403|429|connect|connection|dns|network|proxy|timed?\s*out|websocket/iu.test(detail)) {
		return new NeuralTtsError(
			'EDGE_TTS_NETWORK_FAILED',
			`Edge TTS 网络请求失败${detail ? `：${detail}` : ''}`,
			cause,
		);
	}
	return new NeuralTtsError(
		'EDGE_TTS_PROCESS_FAILED',
		`Edge TTS 子进程失败${detail ? `：${detail}` : ''}`,
		cause,
	);
}

export async function runBoundedProcess(
	invocation: ProcessInvocation,
	options: { signal: AbortSignal; timeoutMs: number },
): Promise<void> {
	if (options.signal.aborted) {
		throw new DOMException('Cancelled', 'AbortError');
	}
	await new Promise<void>((resolve, reject) => {
		const child = spawn(invocation.command, invocation.args, {
			stdio: ['ignore', 'ignore', 'pipe'],
			detached: process.platform !== 'win32',
			env: { ...process.env, PYTHONUNBUFFERED: '1' },
		});
		let stderr = '';
		let settled = false;
		let timedOut = false;
		let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
		const terminate = () => {
			if (!child.pid || child.exitCode !== null) {
				return;
			}
			try {
				if (process.platform === 'win32') {
					child.kill('SIGTERM');
				} else {
					process.kill(-child.pid, 'SIGTERM');
				}
			} catch {
				child.kill('SIGTERM');
			}
			forceKillTimer ??= setTimeout(() => {
				if (child.exitCode === null) {
					child.kill('SIGKILL');
				}
			}, 2000);
			forceKillTimer.unref();
		};
		const finish = (error?: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (forceKillTimer) {
				clearTimeout(forceKillTimer);
			}
			options.signal.removeEventListener('abort', onAbort);
			if (error) {
				reject(error);
			} else {
				// oxlint-disable-next-line promise/no-multiple-resolved -- finish is idempotent.
				resolve();
			}
		};
		const onAbort = () => terminate();
		child.stderr.on('data', (chunk) => {
			stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024);
		});
		child.once('error', (error) => finish(classifyFailure(invocation.command, stderr, error)));
		child.once('close', (code) => {
			if (options.signal.aborted) {
				return finish(new DOMException('Cancelled', 'AbortError'));
			}
			if (timedOut) {
				return finish(
					new NeuralTtsError(
						'EDGE_TTS_TIMEOUT',
						`Edge TTS 超过 ${options.timeoutMs}ms 未完成，进程已终止。`,
					),
				);
			}
			if (code === 0) {
				finish();
			} else {
				finish(classifyFailure(invocation.command, stderr));
			}
		});
		options.signal.addEventListener('abort', onAbort, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, options.timeoutMs);
		timer.unref();
	});
}
