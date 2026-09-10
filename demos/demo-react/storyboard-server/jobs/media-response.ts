import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export interface ByteRange {
	start: number;
	end: number;
}

export function parseByteRange(header: string | undefined, size: number): ByteRange | undefined {
	if (!header) {
		return undefined;
	}
	const match = header.match(/^bytes=(\d*)-(\d*)$/u);
	if (!match) {
		throw new Error('INVALID_RANGE');
	}
	const requestedStart = match[1] ? Number(match[1]) : undefined;
	const requestedEnd = match[2] ? Number(match[2]) : undefined;
	if (requestedStart === undefined && requestedEnd === undefined) {
		throw new Error('INVALID_RANGE');
	}
	const start = requestedStart === undefined ? Math.max(0, size - requestedEnd!) : requestedStart;
	const end =
		requestedStart === undefined ? size - 1 : Math.min(size - 1, requestedEnd ?? size - 1);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start > end ||
		start >= size
	) {
		throw new Error('INVALID_RANGE');
	}
	return { start, end };
}

export async function sendMediaFile(
	request: import('node:http').IncomingMessage,
	response: import('node:http').ServerResponse,
	path: string,
	contentType: string,
): Promise<void> {
	const details = await stat(path);
	response.setHeader('Accept-Ranges', 'bytes');
	response.setHeader('Content-Type', contentType);
	let range: ByteRange | undefined;
	try {
		range = parseByteRange(request.headers.range, details.size);
	} catch {
		response.statusCode = 416;
		response.setHeader('Content-Range', `bytes */${details.size}`);
		response.end();
		return;
	}
	if (!range) {
		response.statusCode = 200;
		response.setHeader('Content-Length', String(details.size));
		createReadStream(path).pipe(response);
		return;
	}
	response.statusCode = 206;
	response.setHeader('Content-Length', String(range.end - range.start + 1));
	response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${details.size}`);
	createReadStream(path, range).pipe(response);
}
