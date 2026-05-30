/**
 * [WHO]: decodeOAuthCredentialSegment
 * [FROM]: No dependencies
 * [TO]: Consumed by core/lib/ai/src/index.ts
 * [HERE]: core/lib/ai/src/utils/oauth/decode-credential.ts — build-time OAuth id/secret embedding
 */

/**
 * Decode base64-embedded OAuth client id or secret at module load.
 * Unreplaced placeholders (e.g. YOUR_CLIENT_ID_HERE) are not valid base64 and must never be passed to
 * `atob` — Node throws InvalidCharacterError and crashes any CLI that imports the OAuth module (e.g. --help).
 */
export function decodeOAuthCredentialSegment(s: string): string {
	const t = s.trim();
	if (t.length === 0) return t;
	if (/YOUR_|PLACEHOLDER|REPLACE_ME/i.test(t)) {
		return t;
	}
	try {
		return atob(t);
	} catch {
		return t;
	}
}
