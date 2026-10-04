/**
 * PKCE utilities using Web Crypto API.
 * Works in both Node.js 20+ and browsers.
 * [WHO]: generatePKCE
 * [FROM]: no external imports
 * [TO]: Consumed by core/lib/ai/src/utils/oauth/anthropic.ts, core/lib/ai/src/utils/oauth/google-antigravity.ts, core/lib/ai/src/utils/oauth/google-gemini-cli.ts, core/lib/ai/src/utils/oauth/openai-codex.ts
 * [HERE]: core/lib/ai/src/utils/oauth/pkce.ts - owned by core/lib/ai/AGENT.md
 */


/**
 * Encode bytes as base64url string.
 */
function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Generate PKCE code verifier and challenge.
 * Uses Web Crypto API for cross-platform compatibility.
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	// Generate random verifier
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);

	// Compute SHA-256 challenge
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const challenge = base64urlEncode(new Uint8Array(hashBuffer));

	return { verifier, challenge };
}
