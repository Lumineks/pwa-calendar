/**
 * Single source of the GitHub Pages base prefix for navigate() calls.
 * Commit 0a3dc1c exists because an unprefixed navigate() broke subpath
 * routing — never call navigate() with a path that doesn't start with this.
 */
export const base = import.meta.env.BASE_URL.replace(/\/$/, '');
