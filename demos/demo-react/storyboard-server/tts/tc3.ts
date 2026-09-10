import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'TC3-HMAC-SHA256';

export interface Tc3SignInput {
	payload: string;
	secretId: string;
	secretKey: string;
	timestamp: number;
	host?: string;
	service?: string;
	action?: string;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
	return createHmac('sha256', key).update(value, 'utf8').digest();
}

export function signTc3(input: Tc3SignInput): string {
	const host = input.host ?? 'tts.tencentcloudapi.com';
	const service = input.service ?? 'tts';
	const action = (input.action ?? 'TextToVoice').toLowerCase();
	const contentType = 'application/json; charset=utf-8';
	const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action}\n`;
	const signedHeaders = 'content-type;host;x-tc-action';
	const canonicalRequest = [
		'POST',
		'/',
		'',
		canonicalHeaders,
		signedHeaders,
		sha256(input.payload),
	].join('\n');
	const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
	const credentialScope = `${date}/${service}/tc3_request`;
	const stringToSign = [ALGORITHM, input.timestamp, credentialScope, sha256(canonicalRequest)].join(
		'\n',
	);
	const secretDate = hmac(`TC3${input.secretKey}`, date);
	const secretService = hmac(secretDate, service);
	const secretSigning = hmac(secretService, 'tc3_request');
	const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
	return `${ALGORITHM} Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
