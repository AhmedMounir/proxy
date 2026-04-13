import * as crypto from "node:crypto";
import * as net from "node:net";
import * as tls from "node:tls";
import { Reactor } from "../engine/reactor";
import type { CAManager } from "./ca";

export class MitmHandler {
	private ca: CAManager;

	constructor(ca: CAManager) {
		this.ca = ca;
	}

	public async handleConnect(
		clientSocket: net.Socket,
		targetHost: string,
		targetPort: number,
		enableMitm: boolean,
	) {
		if (!enableMitm) {
			this.handleBlindRelay(clientSocket, targetHost, targetPort);
			return;
		}

		const certs = this.ca.getCertificateForHost(targetHost);
		const secureContext = tls.createSecureContext({
			key: certs.key,
			cert: certs.cert,
		});

		clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n", (err) => {
			if (err) return; // Client disconnected early

			const tlsSocket = new tls.TLSSocket(clientSocket, {
				isServer: true,
				secureContext: secureContext,
			});

			// The socket is now decrypted. Wait for client to send HTTP payload.
			tlsSocket.on("error", (err) => {
				// Silence WinError 64 issues or gracefully log
				Reactor.emit("request:error", `mitm-${targetHost}`, err);
			});

			tlsSocket.once("data", async (initialData) => {
				try {
					// Determine if it looks like an HTTP request
					const reqString = initialData.toString("utf-8", 0, 500);
					const isHttp =
						reqString.startsWith("GET ") ||
						reqString.startsWith("POST ") ||
						reqString.startsWith("PUT ") ||
						reqString.startsWith("DELETE ") ||
						reqString.startsWith("OPTIONS ") ||
						reqString.startsWith("HEAD ") ||
						reqString.startsWith("PATCH ");

					// Connect to true remote
					const remoteTls = tls.connect(
						targetPort,
						targetHost,
						{ rejectUnauthorized: false },
						() => {
							// Send the intercepted payload
							remoteTls.write(initialData as Buffer);

							// Setup pure streaming pipeline, but tap into reactor for tracing
							if (isHttp) {
								const id = crypto.randomUUID();
								const lines = reqString.split("\r\n");
								const requestLine = lines[0] || "";

								Reactor.emit("request:start", {
									id,
									method: requestLine.split(" ")[0],
									url: requestLine.split(" ")[1] || targetHost,
									protocol: "https",
									startTime: Date.now(),
								});

								Reactor.emit(
									"request:chunk",
									id,
									initialData as Buffer,
									"init",
								);

								tlsSocket.on("data", (chunk) => {
									Reactor.emit("request:chunk", id, chunk as Buffer, "request");
									remoteTls.write(chunk as Buffer);
								});
								remoteTls.on("data", (chunk) => {
									Reactor.emit(
										"request:chunk",
										id,
										chunk as Buffer,
										"response",
									);
									tlsSocket.write(chunk as Buffer);
								});

								const cleanup = () => {
									Reactor.emit("request:end", id, { endTime: Date.now() });
								};
								tlsSocket.on("close", cleanup);
								remoteTls.on("close", cleanup);
							} else {
								// Blind pipe for decrypted non-http
								tlsSocket.pipe(remoteTls);
								remoteTls.pipe(tlsSocket);
							}
						},
					);

					remoteTls.on("error", (err) => {
						Reactor.emit("request:error", `mitm-remote-${targetHost}`, err);
						tlsSocket.destroy();
					});
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err));
					Reactor.emit("request:error", `mitm-catch-${targetHost}`, error);
					tlsSocket.destroy();
				}
			});
		});
	}

	private handleBlindRelay(
		clientSocket: net.Socket,
		targetHost: string,
		targetPort: number,
	) {
		const id = crypto.randomUUID();
		Reactor.emit("request:start", {
			id,
			method: "CONNECT",
			url: `${targetHost}:${targetPort}`,
			protocol: "connect",
			startTime: Date.now(),
		});

		const serverSocket = net.connect(targetPort, targetHost, () => {
			clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			clientSocket.pipe(serverSocket);
			serverSocket.pipe(clientSocket);
		});

		serverSocket.on("error", () => clientSocket.destroy());
		clientSocket.on("error", () => serverSocket.destroy());

		serverSocket.on("close", () => {
			Reactor.emit("request:end", id, { endTime: Date.now() });
		});
	}
}
