/**
 * [WHO]: Provides useConnectionStore, ConnectionTarget, parseConnectDeepLink(), parseConnectPageUrl()
 * [FROM]: Depends on zustand, zustand/middleware, @capacitor/preferences, jsqr-free URL parsing only
 * [TO]: Consumed by src/state/wiring.ts, src/connection/ConnectScreen.tsx, src/views/ChatView.tsx
 * [HERE]: apps/mobile/src/connection/connection-store.ts - connection state: current target + saved history, persisted via @capacitor/preferences (localStorage on web, native storage in the APK)
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { Preferences } from "@capacitor/preferences";

export interface ConnectionTarget {
	/** WebSocket endpoint, e.g. ws://192.168.0.17:8787/ws */
	endpoint: string;
	/** Fallback endpoints tried in order when the primary fails (multi-NIC hosts). */
	altEndpoints?: string[];
	token: string;
	/** Display name (defaults to host). */
	name?: string;
}

interface ConnectionStore {
	/** Currently connected (or connecting) target; null = show connect screen. */
	current: ConnectionTarget | null;
	history: ConnectionTarget[];
	connect(target: ConnectionTarget): void;
	disconnect(): void;
	/** Drop a saved target from history. */
	forget(endpoint: string): void;
}

const preferencesStorage = {
	getItem: async (key: string): Promise<string | null> => {
		const { value } = await Preferences.get({ key });
		return value ?? null;
	},
	setItem: async (key: string, value: string): Promise<void> => {
		await Preferences.set({ key, value });
	},
	removeItem: async (key: string): Promise<void> => {
		await Preferences.remove({ key });
	},
};

export const useConnectionStore = create<ConnectionStore>()(
	persist(
		(set, get) => ({
			current: null,
			history: [],
			connect: (target) => {
				const history = [
					target,
					...get().history.filter((entry) => entry.endpoint !== target.endpoint),
				].slice(0, 10);
				set({ current: target, history });
			},
			disconnect: () => set({ current: null }),
			forget: (endpoint) =>
				set({ history: get().history.filter((entry) => entry.endpoint !== endpoint) }),
		}),
		{
			name: "catui-connections",
			storage: createJSONStorage(() => preferencesStorage),
			partialize: (state) => ({ history: state.history }) as ConnectionStore,
		},
	),
);

/** Parse a `catui://connect?endpoint=...&alt=...&token=...&name=...` deep link. */
export function parseConnectDeepLink(link: string): ConnectionTarget | null {
	try {
		const url = new URL(link);
		// WHATWG parses "catui://connect" with host "connect" and empty pathname.
		if (url.protocol !== "catui:") return null;
		if (url.host !== "connect") return null;
		const endpoint = url.searchParams.get("endpoint");
		const token = url.searchParams.get("token");
		if (!endpoint || !token) return null;
		const alt = url.searchParams
			.get("alt")
			?.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		return { endpoint, token, altEndpoints: alt?.length ? alt : undefined, name: url.searchParams.get("name") ?? undefined };
	} catch {
		return null;
	}
}

/**
 * Browser entry: the serve-mode banner URL looks like
 * http://<lan-ip>:8787/?token=... — same-origin WebSocket, token pre-filled.
 */
export function targetFromPageUrl(): ConnectionTarget | null {
	if (typeof window === "undefined") return null;
	const url = new URL(window.location.href);
	const token = url.searchParams.get("token");
	if (!token) return null;
	const protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return { endpoint: `${protocol}//${url.host}/ws`, token, name: url.hostname };
}

/** Normalize user-typed endpoints: add ws://, append /ws path. */
export function normalizeEndpoint(input: string): string {
	let value = input.trim();
	if (!value) return value;
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
		value = `ws://${value}`;
	}
	try {
		const url = new URL(value);
		if (url.protocol !== "ws:" && url.protocol !== "wss:") return value;
		if (!url.pathname || url.pathname === "/") {
			value = `${url.protocol}//${url.host}/ws`;
		}
	} catch {
		// leave as-is; connection attempt will surface the error
	}
	return value;
}
