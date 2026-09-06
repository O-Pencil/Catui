/**
 * [WHO]: Provides connectTo(), disconnectAndForget(), initDeepLinks(), initWiring()
 * [FROM]: Depends on @capacitor/app, src/protocol/client, src/state/session-store, src/connection/connection-store
 * [TO]: Consumed by src/main.tsx (side-effect import); deep links consumed by the APK shell
 * [HERE]: apps/mobile/src/state/wiring.ts - one-time wiring between the transport singleton and the stores: server message -> store dispatch, status -> resync + pairing-failure detection + healthz probe fan-out, catui://connect deep link (cold start + warm resume) -> connectTo
 */
import { App as CapApp } from "@capacitor/app";
import { remoteClient } from "../protocol/client";
import { useSessionStore, type PairingProbe } from "./session-store";
import { useConnectionStore, parseConnectDeepLink, type ConnectionTarget } from "../connection/connection-store";

const sessionStore = useSessionStore;
let everConnected = false;
/** Guards against re-probing the same target on every reconnect backoff cycle. */
let lastProbedKey = "";

remoteClient.onStatus((status, detail) => {
	sessionStore.getState().setStatus(status, detail);
	if (status === "connected") {
		everConnected = true;
		useSessionStore.setState({ connectFailed: false, pairingProbes: [], probesState: "idle" });
		// Reconnect resync: snapshot first, live events keep it fresh afterwards
		void sessionStore.getState().resync();
		void sessionStore.getState().refreshSessions();
	} else if (status === "disconnected" && !everConnected) {
		// Never reached "connected" once: wrong address or stale token (token
		// regenerates on every --serve restart) — surface a re-pair hint and
		// probe the endpoints to tell network problems apart from token problems.
		useSessionStore.setState({ connectFailed: true });
		const target = useConnectionStore.getState().current;
		if (target) {
			const key = `${target.endpoint}|${target.token}`;
			if (key !== lastProbedKey) {
				lastProbedKey = key;
				void runPairingProbes(target);
			}
		}
	}
});

remoteClient.onMessage((message) => {
	sessionStore.getState().handleServerMessage(message);
});

/**
 * Probe each candidate endpoint via /healthz (CORS-open on the server):
 * - fetch fails           → network unreachable (different WiFi, AP isolation, firewall)
 * - ok but tokenValid:false → server reachable, token stale (serve restarted)
 * - ok and tokenValid:true  → transient WS failure; reconnect backoff will retry
 */
async function runPairingProbes(target: ConnectionTarget): Promise<void> {
	const endpoints = [target.endpoint, ...(target.altEndpoints ?? [])];
	useSessionStore.setState({ probesState: "running", pairingProbes: [] });
	const probes = await Promise.all(
		endpoints.map(async (endpoint): Promise<PairingProbe> => {
			let probeUrl: string;
			try {
				const url = new URL(endpoint);
				url.protocol = url.protocol === "wss:" ? "https:" : "http:";
				url.pathname = "/healthz";
				url.searchParams.set("token", target.token);
				probeUrl = url.toString();
			} catch {
				return { endpoint, status: "unreachable", detail: "无效的服务地址" };
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 5000);
			try {
				const response = await fetch(probeUrl, { signal: controller.signal });
				const body = (await response.json().catch(() => null)) as { tokenValid?: boolean } | null;
				if (body?.tokenValid === true) {
					return { endpoint, status: "ok" };
				}
				return { endpoint, status: "badToken" };
			} catch (e) {
				const detail = e instanceof Error ? e.message : String(e);
				return { endpoint, status: "unreachable", detail };
			} finally {
				clearTimeout(timer);
			}
		}),
	);
	useSessionStore.setState({ pairingProbes: probes, probesState: "done" });
}

/** Initiate a connection and remember the target. */
export function connectTo(target: ConnectionTarget): void {
	everConnected = false;
	lastProbedKey = "";
	useSessionStore.setState({ connectFailed: false, pairingProbes: [], probesState: "idle" });
	useConnectionStore.getState().connect(target);
	remoteClient.connect([target.endpoint, ...(target.altEndpoints ?? [])], target.token);
}

/** Tear down and return to the connect screen. */
export function disconnectAndForget(): void {
	remoteClient.disconnect();
	useConnectionStore.getState().disconnect();
	sessionStore.setState({
		state: null,
		messages: [],
		sessions: [],
		dialogs: [],
		widgets: {},
		editorPrefill: undefined,
		connectFailed: false,
		pairingProbes: [],
		probesState: "idle",
	});
}

/**
 * Deep link handling: `catui://connect?endpoint=...&token=...&name=...`
 * Covers both cold start (getLaunchUrl) and warm resume (appUrlOpen).
 */
export async function initDeepLinks(): Promise<void> {
	try {
		const { getLaunchUrl, addListener } = CapApp;
		const launch = await getLaunchUrl();
		if (launch?.url) {
			applyDeepLink(launch.url);
		}
		await addListener("appUrlOpen", (event) => {
			if (event.url) {
				applyDeepLink(event.url);
			}
		});
	} catch {
		// Running in a plain browser (no Capacitor runtime) — nothing to do
	}
}

function applyDeepLink(url: string): void {
	const target = parseConnectDeepLink(url);
	if (target) {
		connectTo(target);
	}
}
