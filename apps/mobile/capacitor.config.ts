import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
	appId: "app.catui.mobile",
	appName: "Catui",
	webDir: "dist",
	backgroundColor: "#efece2",
	android: {
		// The app is served from https://localhost but connects to plain
		// ws:// LAN endpoints (and Tailscale IPs) — allow that mix.
		allowMixedContent: true,
	},
	server: {
		androidScheme: "https",
	},
};

export default config;
