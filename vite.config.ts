import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

export default defineConfig(({ mode }) => {
	let base = "/";

	if (mode === "production" && pkg.homepage) {
		try {
			base = new URL(pkg.homepage).pathname;
		} catch {
			base = "/";
		}
		if (!base.endsWith("/")) base = `${base}/`;
	}

	return {
		plugins: [
			react(),
			tailwindcss(),
			VitePWA({
				strategies: "injectManifest",
				srcDir: "src/sw",
				filename: "sw.ts",
				registerType: "autoUpdate",
				injectManifest: {
					globPatterns: [],
				},
			}),
		],
		base,
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		test: {
			environment: "jsdom",
			setupFiles: "./src/test/setup.ts",
			globals: true,
			include: ["src/**/*.{test,spec}.{ts,tsx}"],
			exclude: ["e2e/**", "node_modules/**"],
		},
	};
});
