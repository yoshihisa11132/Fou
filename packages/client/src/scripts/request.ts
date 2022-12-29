import { $i } from '@/account';

export const request = async (url: string, body?: Record<string, any>, options?: Record<string, any>, token?: string) => {
	let requestOptions = {};

	const authorizationToken = token ?? $i?.token ?? undefined;
	const authorization = authorizationToken ? `Bearer ${authorizationToken}` : undefined;

	requestOptions = {
		...{
			headers: {
				'content-type': 'application/json',
				...(authorization ? { authorization } : {}),
			},
		},
		...options,
	};

	const response = await fetch(url, {
		...requestOptions,
		body: body ? JSON.stringify(body) : undefined,
	});

	const responseBody = response.status === 204 ? null : await response.json();

	if (response.status === 200) {
		return responseBody;
	}
	else if (response.status === 204) {
		return null;
	}
	else {
		throw new Error(responseBody.error);
	}
};

export const get = async (url: string, options?: Record<string, any>, token?: string) => {
	return request(url, undefined, { method: 'GET' }, token);
};

export const post = async (url: string, body: Record<string, any>, options?: Record<string, any>, token?: string) => {
	return request(url, body, { method: 'POST' }, token);
};

export const put = async (url: string, body: Record<string, any>, options?: Record<string, any>, token?: string) => {
	return request(url, body, { method: 'PUT' }, token);
};

export const del = async (url: string, options?: Record<string, any>, token?: string) => {
	return request(url, undefined, { method: 'DELETE' }, token);
};
