/**
 * Set up HTTP proxy according to env variables for `fetch` based SDKs in Node.js.
 * Bun has builtin support for this.
 * This module should be imported early by any code that needs proxy support for fetch().
 * ES modules are cached, so importing multiple times is safe - setup only runs once.
 * [WHO]: side-effect module — exports nothing; importing it performs the work
 * [FROM]: no external imports
 * [TO]: Re-exported through the package barrel; no tracked direct importer
 * [HERE]: core/lib/ai/src/utils/http-proxy.ts - owned by core/lib/ai/AGENT.md
 */


if (typeof process !== "undefined" && process.versions?.node) {
	import("undici").then((m) => {
		const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
		setGlobalDispatcher(new EnvHttpProxyAgent());
	});
}
