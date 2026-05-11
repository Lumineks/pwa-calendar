import { writable } from 'svelte/store';
import type { Readable } from 'svelte/store';

const LS_KEY = 'journal:token';

function readToken(): string | null {
	try {
		return localStorage.getItem(LS_KEY);
	} catch {
		return null;
	}
}

const _token = writable<string | null>(readToken());

export const token: Readable<string | null> = { subscribe: _token.subscribe };

export function setToken(value: string): void {
	localStorage.setItem(LS_KEY, value);
	_token.set(value);
}

export function clearToken(): void {
	localStorage.removeItem(LS_KEY);
	_token.set(null);
}
