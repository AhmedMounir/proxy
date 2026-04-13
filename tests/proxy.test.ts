import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";
import { Reactor } from "../src/engine/reactor";
import { CAManager } from "../src/proxy/ca";
import { ProxyServer } from "../src/proxy/server";

describe("Reactor Event Bus", () => {
	test("should emit and subscribe to request metrics asynchronously", () => {
		return new Promise<void>((resolve) => {
			Reactor.once("request:start", (req) => {
				expect(req.id).toBe("test-123");
				expect(req.method).toBe("GET");
				expect(req.protocol).toBe("http");
				resolve();
			});

			Reactor.emit("request:start", {
				id: "test-123",
				method: "GET",
				url: "http://tester.local",
				protocol: "http",
				startTime: Date.now(),
			});
		});
	});
});

describe("Proxy Server core logic", () => {
	let dummyTargetServer: http.Server;
	const proxyHost = "127.0.0.1";
	let proxyPort = 0;
	const targetHost = "127.0.0.1";
	let targetPort = 0;
	let server: ProxyServer;

	beforeAll(async () => {
		// Setup a dummy target HTTP server
		dummyTargetServer = http.createServer((req, res) => {
			console.log("Dummy server received request", req.url);
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end("TARGET_REACHED");
		});
		await new Promise<void>((resolve) => {
			dummyTargetServer.listen(0, targetHost, () => {
				targetPort = (dummyTargetServer.address() as net.AddressInfo).port;
				resolve();
			});
		});

		// Setup the proxy
		const ca = new CAManager("./ca.pem", "./ca-key.pem");
		server = new ProxyServer(ca);
		await new Promise<void>((resolve) => {
			const netServer = (server as unknown as { server: net.Server }).server;
			netServer.listen(0, proxyHost, () => {
				proxyPort = (netServer.address() as net.AddressInfo).port;
				resolve();
			});
		});
	});

	afterAll(() => {
		server.stop();
		dummyTargetServer.close();
	});

	test("should cleanly blind-relay an HTTP request to the target", async () => {
		return new Promise<void>((resolve, reject) => {
			const client = net.connect(proxyPort, proxyHost, () => {
				const request = `GET / HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nConnection: close\r\n\r\n`;
				client.write(request);
			});

			let data = "";
			client.on("data", (chunk) => {
				console.log("Client received data from proxy");
				data += chunk.toString("utf-8");
				if (data.includes("TARGET_REACHED")) {
					client.end();
					resolve();
				}
			});
			client.on("error", (err) => {
				console.log("Client error", err);
				reject(err);
			});
		});
	});

	test("should handle CONNECT method for blind relay (mitmEnabled=false)", async () => {
		server.mitmEnabled = false;
		return new Promise<void>((resolve, reject) => {
			const client = net.connect(proxyPort, proxyHost, () => {
				const request = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`;
				client.write(request);
			});

			let data = "";
			let connected = false;
			client.on("data", (chunk) => {
				data += chunk.toString("utf-8");
				if (!connected && data.includes("200 Connection Established")) {
					connected = true;
					data = ""; // clear buffer
					// Connection established! Now send HTTP request over the tunnel
					client.write(
						`GET / HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nConnection: close\r\n\r\n`,
					);
				} else if (connected && data.includes("TARGET_REACHED")) {
					client.end();
					resolve();
				}
			});
			client.on("error", reject);
		});
	});
});
