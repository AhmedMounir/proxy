import * as crypto from "node:crypto";
import * as net from "node:net";
import { Reactor } from "../engine/reactor";
import type { CAManager } from "./ca";
import { MitmHandler } from "./mitm";

export class ProxyServer {
	private server: net.Server;
	private mitmHandler: MitmHandler;
	private connections: Set<net.Socket> = new Set();
	public mitmEnabled: boolean = false;

	constructor(ca: CAManager) {
		this.mitmHandler = new MitmHandler(ca);
		this.server = net.createServer(this.handleConnection.bind(this));

		this.server.on("connection", (socket) => {
			this.connections.add(socket);
			Reactor.emit("connection:active", this.connections.size);

			socket.on("close", () => {
				this.connections.delete(socket);
				Reactor.emit("connection:active", this.connections.size);
			});
		});
	}

	public async start(port: number, host: string = "0.0.0.0") {
		return new Promise<void>((resolve, reject) => {
			this.server.listen(port, host, () => {
				resolve();
			});
			this.server.on("error", reject);
		});
	}

	public stop() {
		this.server.close();
		for (const socket of this.connections) {
			socket.destroy();
		}
	}

	private handleConnection(clientSocket: net.Socket) {
		clientSocket.once("data", (data) => {
			const requestStr = data.toString("utf-8", 0, 1024);
			const lines = requestStr.split("\r\n");
			const reqLine = lines[0];

			console.log("PROXY RECEIVED:", reqLine);

			if (!reqLine) return clientSocket.destroy();

			const [method, target, _version] = reqLine.split(" ");

			if (method === "CONNECT" && target) {
				let targetHost = target;
				let targetPort = 443;

				if (target.includes(":")) {
					const parts = target.split(":");
					targetHost = parts[0] ?? targetHost;
					targetPort = parseInt(parts[1] || "443", 10);
				}

				// Handle the connection
				this.mitmHandler
					.handleConnect(clientSocket, targetHost, targetPort, this.mitmEnabled)
					.catch((err) => {
						Reactor.emit("request:error", "mitm-error", err);
						clientSocket.destroy();
					});
			} else {
				this.handlePlainHttp(clientSocket, data as Buffer, reqLine, lines);
			}
		});

		clientSocket.on("error", (_err) => {
			// Silently ignore standard reset errors
		});
	}

	private handlePlainHttp(
		clientSocket: net.Socket,
		initialData: Buffer,
		reqLine: string,
		lines: string[],
	) {
		let host = "";
		console.log("Header lines:", lines);
		for (const line of lines) {
			if (line.toLowerCase().startsWith("host:")) {
				host = line.substring(5).trim();
				break;
			}
		}

		console.log("Extracted host:", host);

		if (!host) {
			console.log("No host, destroying");
			return clientSocket.destroy();
		}

		let targetHost = host;
		let targetPort = 80;

		if (host.includes(":")) {
			const parts = host.split(":");
			targetHost = parts[0] ?? targetHost;
			targetPort = parseInt(parts[1] || "80", 10);
		}

		console.log("Parsing Target...", targetHost, targetPort);
		const id = crypto.randomUUID();
		console.log("Got id:", id);
		const [method, target] = reqLine.split(" ");

		console.log("Emitting reactor...");
		Reactor.emit("request:start", {
			id,
			method: method || "UNKNOWN",
			url: target || targetHost,
			protocol: "http",
			startTime: Date.now(),
		});

		console.log("Connecting to target server:", targetHost, targetPort);
		const serverSocket = net.connect(targetPort, targetHost, () => {
			console.log("Connected, writing data:", initialData.length, "bytes");
			serverSocket.write(initialData as Buffer);

			clientSocket.on("data", (chunk) => {
				Reactor.emit("request:chunk", id, chunk as Buffer, "request");
				serverSocket.write(chunk as Buffer);
			});
			serverSocket.on("data", (chunk) => {
				Reactor.emit("request:chunk", id, chunk as Buffer, "response");
				clientSocket.write(chunk as Buffer);
			});
		});

		serverSocket.on("end", () => clientSocket.end());
		clientSocket.on("end", () => serverSocket.end());

		serverSocket.on("error", (err) => {
			console.log("Server socket error:", err);
			clientSocket.destroy();
		});
		clientSocket.on("error", (err) => {
			console.log("Client socket error:", err);
			serverSocket.destroy();
		});

		serverSocket.on("close", () => {
			Reactor.emit("request:end", id, { endTime: Date.now() });
		});
	}
}
