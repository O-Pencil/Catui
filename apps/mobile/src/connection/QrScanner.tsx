import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface QrScannerProps {
	onResult: (payload: string) => void;
	onClose: () => void;
}

/**
 * Camera QR scanner (jsQR). Works in the APK (secure context via the
 * https://localhost scheme) and in browsers on https/localhost; plain-LAN
 * http pages get getUserMedia blocked, which we surface as a hint.
 */
export default function QrScanner({ onResult, onClose }: QrScannerProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let stream: MediaStream | null = null;
		let timer: ReturnType<typeof setInterval> | null = null;
		let cancelled = false;

		async function start() {
			if (!navigator.mediaDevices?.getUserMedia) {
				setError("当前环境无法使用相机（需要 HTTPS 或 APK 环境），请返回使用手动输入。");
				return;
			}
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: "environment" },
					audio: false,
				});
			} catch (e) {
				setError(`相机打开失败：${(e as Error).message}`);
				return;
			}
			if (cancelled) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			const video = videoRef.current;
			if (!video) return;
			video.srcObject = stream;
			await video.play().catch(() => undefined);

			const canvas = document.createElement("canvas");
			const context = canvas.getContext("2d", { willReadFrequently: true });

			timer = setInterval(() => {
				if (!context || video.videoWidth === 0) return;
				const width = Math.min(video.videoWidth, 480);
				const height = Math.round((video.videoHeight / video.videoWidth) * width);
				canvas.width = width;
				canvas.height = height;
				context.drawImage(video, 0, 0, width, height);
				const image = context.getImageData(0, 0, width, height);
				const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
				if (found?.data) {
					onResult(found.data);
				}
			}, 250);
		}

		void start();
		return () => {
			cancelled = true;
			if (timer) clearInterval(timer);
			stream?.getTracks().forEach((track) => track.stop());
		};
	}, [onResult]);

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-black">
			<div className="safe-top flex items-center justify-between px-4 py-3">
				<span className="font-semibold text-panel">扫描配对二维码</span>
				<button type="button" className="rounded-lg bg-panel px-3 py-1.5 text-sm text-ink" onClick={onClose}>
					关闭
				</button>
			</div>
			<div className="relative flex-1 overflow-hidden">
				<video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
				<div className="pointer-events-none absolute inset-x-8 top-1/2 h-64 -translate-y-1/2 rounded-2xl border-2 border-accent/80" />
				{error && (
					<div className="absolute inset-x-4 bottom-6 rounded-xl bg-panel p-4 text-sm text-ink">{error}</div>
				)}
			</div>
		</div>
	);
}
