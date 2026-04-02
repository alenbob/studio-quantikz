declare global {
	interface Window {
		quantikzDesktop?: {
			copyText?: (text: string) => Promise<boolean>;
		};
	}
}

export {};
