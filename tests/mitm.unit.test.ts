import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type * as net from "node:net";
import { CAManager } from "../src/proxy/ca";
import { MitmHandler } from "../src/proxy/mitm";

// Mocking tls module
mock.module("node:tls", () => {
	class MockTLSSocket extends EventEmitter {
		isServer: boolean;
		constructor(socket: any, options: any) {
			super();
			this.isServer = options?.isServer;
			// simulate a connected socket receiving data after a short delay
			setTimeout(() => {
				// We decide based on a flag attached to the socket for testing
				if (socket.nonHttp) {
					this.emit("data", Buffer.from("BOGUS DATA NON HTTP"));
				} else {
					this.emit(
						"data",
						Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"),
					);
				}
			}, 10);
		}
		destroy() {}
		write() {}
		pipe() {}
	}

	class MockRemoteTls extends EventEmitter {
		destroy() {}
		write() {}
		pipe() {}
	}

	return {
		TLSSocket: MockTLSSocket,
		connect: mock((...args: unknown[]) => {
			const cb = args[args.length - 1];
			const socket = new MockRemoteTls();
			if (typeof cb === "function") {
				setTimeout(() => cb(), 10);
			}
			return socket;
		}),
		createSecureContext: mock(() => ({})),
	};
});

describe("MitmHandler Unit Tests", () => {
	const ca = new CAManager("./ca.pem", "./ca-key.pem");
	const handler = new MitmHandler(ca);

	afterEach(() => {
		mock.restore(); // Though mock.module persists, we clear mocks if any
	});

	test("should handleConnect with enableMitm = true and mock TLS", async () => {
		const clientSocket = new EventEmitter() as unknown as net.Socket;
		(clientSocket as Record<string, unknown>).write = mock(
			(_text: string, cb?: (err: Error | null) => void) => {
				if (cb) cb(null);
			},
		);
		(clientSocket as Record<string, unknown>).destroy = mock();

		handler.handleConnect(clientSocket, "example.com", 443, true);

		// Wait a tick for write callback and timeout to execute
		await new Promise((r) => setTimeout(r, 50));

		// Now clientSocket.write should have been called
		expect(clientSocket.write).toHaveBeenCalled();
	});

	test("should handleConnect with enableMitm = true and non-HTTP data", async () => {
		const clientSocket = new EventEmitter() as unknown as net.Socket;
		(clientSocket as Record<string, unknown>).nonHttp = true;
		(clientSocket as Record<string, unknown>).write = mock(
			(_text: string, cb?: (err: Error | null) => void) => {
				if (cb) cb(null);
			},
		);
		(clientSocket as Record<string, unknown>).destroy = mock();

		handler.handleConnect(clientSocket, "example.com", 443, true);

		await new Promise((r) => setTimeout(r, 50));
		expect(clientSocket.write).toHaveBeenCalled();
	});
});
