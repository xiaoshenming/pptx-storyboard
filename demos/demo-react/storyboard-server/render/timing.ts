import type { StoryboardJobManifest } from '../jobs/job-types';
import type { SynthesizedShotAudio } from './video-renderer';

export interface CompiledAudioTiming {
	clipId: string;
	startMs: number;
	startSample: number;
}

export interface CompiledRenderTiming {
	shotFrameCounts: number[];
	shotDurationsMs: number[];
	shotStartsMs: number[];
	totalDurationMs: number;
	audio: Map<string, CompiledAudioTiming>;
}

const AUDIO_TAIL_MS = 250;
const MIX_SAMPLE_RATE = 48_000;

export function compileRenderTiming(
	manifest: StoryboardJobManifest,
	audio: SynthesizedShotAudio[],
): CompiledRenderTiming {
	const audioByShot = new Map<string, SynthesizedShotAudio[]>();
	for (const clip of audio) {
		const clips = audioByShot.get(clip.sourceShotId) ?? [];
		clips.push(clip);
		audioByShot.set(clip.sourceShotId, clips);
	}

	const requiredDurationsMs = manifest.shots.map((shot, index) => {
		const next = manifest.shots[index + 1];
		const nominalSpan = next
			? Math.max(shot.durationMs, next.startMs - shot.startMs)
			: shot.durationMs;
		const requiredSpan = (audioByShot.get(shot.id) ?? []).reduce((maximum, clip) => {
			const localOffsetMs = Math.max(0, clip.startMs - shot.startMs);
			return Math.max(maximum, localOffsetMs + clip.durationMs + AUDIO_TAIL_MS);
		}, 0);
		return Math.max(nominalSpan, requiredSpan);
	});
	const shotFrameCounts = requiredDurationsMs.map((durationMs, index) =>
		Math.max(manifest.shots[index].frameCount, Math.ceil((durationMs / 1000) * manifest.fps)),
	);
	const shotDurationsMs = shotFrameCounts.map((frames) => (frames / manifest.fps) * 1000);

	const shotStartsMs: number[] = [];
	let cursorMs = 0;
	for (const durationMs of shotDurationsMs) {
		shotStartsMs.push(cursorMs);
		cursorMs += durationMs;
	}

	const shotIndex = new Map(manifest.shots.map((shot, index) => [shot.id, index]));
	const compiledAudio = new Map<string, CompiledAudioTiming>();
	for (const clip of audio) {
		const index = shotIndex.get(clip.sourceShotId);
		if (index === undefined) {
			continue;
		}
		const sourceShot = manifest.shots[index];
		const localOffsetMs = Math.max(0, clip.startMs - sourceShot.startMs);
		const startMs = shotStartsMs[index] + localOffsetMs;
		compiledAudio.set(clip.clipId, {
			clipId: clip.clipId,
			startMs,
			startSample: Math.round((startMs / 1000) * MIX_SAMPLE_RATE),
		});
	}

	return {
		shotFrameCounts,
		shotDurationsMs,
		shotStartsMs,
		totalDurationMs: cursorMs,
		audio: compiledAudio,
	};
}
