import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	// A few specs are timing-sensitive (smooth scroll, touch gestures) and can
	// flake under parallel load while passing in isolation; retry them.
	retries: process.env.CI ? 2 : 1,
	use: {
		baseURL: "http://127.0.0.1:5173",
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1",
		url: "http://127.0.0.1:5173",
		reuseExistingServer: !process.env.CI,
	},
});
