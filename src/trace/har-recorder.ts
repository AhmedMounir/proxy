import * as fs from "node:fs";
import { Reactor, type RequestRecord } from "../engine/reactor";

export class HarRecorder {
	private requests: Map<string, RequestRecord> = new Map();
	private isRecording: boolean = false;
	private outputFile: string;

	constructor(outputFile: string = "trace.har") {
		this.outputFile = outputFile;

		Reactor.on("request:start", (req) => {
			if (!this.isRecording) return;
			this.requests.set(req.id, {
				...req,
				requestBody: Buffer.alloc(0),
				responseBody: Buffer.alloc(0),
			} as RequestRecord);
		});

		Reactor.on("request:chunk", (id, chunk, type) => {
			if (!this.isRecording) return;
			const req = this.requests.get(id);
			if (!req) return;

			if (type === "init") {
				// First chunk of HTTP contains headers usually, skipped in raw for simplicity
			} else if (type === "request") {
				req.requestBody = Buffer.concat([
					req.requestBody || Buffer.alloc(0),
					chunk,
				]);
			} else if (type === "response") {
				req.responseBody = Buffer.concat([
					req.responseBody || Buffer.alloc(0),
					chunk,
				]);
			}
		});

		Reactor.on("request:end", (id, update) => {
			if (!this.isRecording) return;
			const req = this.requests.get(id);
			if (!req) return;

			req.endTime = update.endTime;
			this.requests.set(id, req);

			// To prevent massive memory leak, we can flush periodically or wait
		});
	}

	public startRecording() {
		this.isRecording = true;
	}

	public stopRecording() {
		this.isRecording = false;
		this.dumpToFile();
	}

	public getStatus() {
		return this.isRecording;
	}

	private dumpToFile() {
		const entries = Array.from(this.requests.values()).map((req) => {
			const time = (req.endTime || Date.now()) - req.startTime;
			return {
				startedDateTime: new Date(req.startTime).toISOString(),
				time: time > 0 ? time : 1,
				request: {
					method: req.method,
					url: req.url,
					httpVersion: "HTTP/1.1",
					cookies: [],
					headers: [],
					queryString: [],
					headersSize: -1,
					bodySize: req.requestBody?.length || 0,
				},
				response: {
					status: 200,
					statusText: "OK",
					httpVersion: "HTTP/1.1",
					cookies: [],
					headers: [],
					content: {
						size: req.responseBody?.length || 0,
						mimeType: "text/plain", // Defaulting for simple trace
					},
					redirectURL: "",
					headersSize: -1,
					bodySize: req.responseBody?.length || 0,
				},
				cache: {},
				timings: {
					send: 0,
					wait: time,
					receive: 0,
				},
			};
		});

		const har = {
			log: {
				version: "1.2",
				creator: {
					name: "Bun TUI Proxy",
					version: "1.0.0",
				},
				entries: entries,
			},
		};

		fs.writeFileSync(this.outputFile, JSON.stringify(har, null, 2));
		this.requests.clear();
	}
}
