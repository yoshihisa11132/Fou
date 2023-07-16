import { URLSearchParams } from 'node:url';
import { getResponse } from '@/misc/fetch.js';
import config from '@/config/index.js';

export async function verifyRecaptcha(secret: string, response: string): Promise<void> {
	const result = await getCaptchaResponse('https://www.recaptcha.net/recaptcha/api/siteverify', secret, response).catch(e => {
		throw new Error(`recaptcha-request-failed: ${e.message}`);
	});

	if (result.success !== true) {
		const errorCodes = result['error-codes'] ? result['error-codes'].join(', ') : '';
		throw new Error(`recaptcha-failed: ${errorCodes}`);
	}
}

export async function verifyHcaptcha(secret: string, response: string): Promise<void> {
	const result = await getCaptchaResponse('https://hcaptcha.com/siteverify', secret, response).catch(e => {
		throw new Error(`hcaptcha-request-failed: ${e.message}`);
	});

	if (result.success !== true) {
		const errorCodes = result['error-codes'] ? result['error-codes'].join(', ') : '';
		throw new Error(`hcaptcha-failed: ${errorCodes}`);
	}
}

type CaptchaResponse = {
	success: boolean;
	'error-codes'?: string[];
};

async function getCaptchaResponse(url: string, secret: string, response: string): Promise<CaptchaResponse> {
	const params = new URLSearchParams({
		secret,
		response,
	});

	const res = await getResponse({
		url,
		method: 'POST',
		body: params,
	}).catch(e => {
		throw new Error(`${e.message || e}`);
	});

	if (!res.ok) {
		throw new Error(`${res.status}`);
	}

	return await res.json() as CaptchaResponse;
}
