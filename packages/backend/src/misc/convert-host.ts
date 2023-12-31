import { toASCII } from 'punycode';
import { URL } from 'node:url';
import config from '@/config/index.js';

export function getFullApAccount(username: string, host: string | null): string {
	return host ? `${username}@${toPuny(host)}` : `${username}@${toPuny(config.host)}`;
}

export function isSelfHost(host: string | null): boolean {
	if (host == null) return true;
	return toPuny(config.host) === toPuny(host);
}

export function extractPunyHost(uri: string): string {
	const url = new URL(uri);
	return toPuny(url.hostname);
}

export function toPuny(host: string): string {
	return toASCII(host.toLowerCase());
}

export function toPunyNullable(host: string | null | undefined): string | null {
	if (host == null) return null;
	return toASCII(host.toLowerCase());
}
