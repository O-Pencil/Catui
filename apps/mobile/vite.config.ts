import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		// Expose on LAN during development so the phone can reach the dev server
		host: true,
	},
	build: {
		outDir: "dist",
		target: "es2022",
	},
});
