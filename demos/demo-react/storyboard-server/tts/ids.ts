import { createHash } from 'node:crypto';

import type { TtsSegmentId, TtsTaskId } from './types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function validateId(value: string, label: string, maxLength: number): string {
	const normalized = value.trim();
	if (normalized.length > maxLength || !ID_PATTERN.test(normalized)) {
		throw new TypeError(`${label} must be 1-${maxLength} safe ASCII characters`);
	}
	return normalized;
}

export function asTtsTaskId(value: string): TtsTaskId {
	return validateId(value, 'taskId', 100) as TtsTaskId;
}

export function asTtsSegmentId(value: string): TtsSegmentId {
	return validateId(value, 'segmentId', 128) as TtsSegmentId;
}

export function createTtsTaskId(stableInput: string): TtsTaskId {
	const digest = createHash('sha256').update(stableInput, 'utf8').digest('hex').slice(0, 24);
	return asTtsTaskId(`tts-${digest}`);
}

export function createTtsSegmentId(taskId: TtsTaskId, index: number): TtsSegmentId {
	if (!Number.isSafeInteger(index) || index < 0) {
		throw new TypeError('segment index must be >= 0');
	}
	return asTtsSegmentId(`${taskId}:segment:${String(index).padStart(4, '0')}`);
}
