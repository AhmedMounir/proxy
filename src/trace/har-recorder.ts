import * as fs from "node:fs";
import { Reactor, type RequestRecord } from "../engine/reactor";

const MAX_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB limit per connection stream to prevent RAM exhaustion


function parseHttpBuffer(buffer: Buffer, isRequest: boolean) {
	const separatorIdx = buffer.indexOf("\r\n\r\n");
	if (separatorIdx === -1) {
		return {
			status: isRequest ? 200 : 0,
			statusText: isRequest ? "" : "Unknown",
			method: "",
			url: "",
			headers: [] as { name: string; value: string }[],
			headersSize: -1,
			body: buffer,
			bodySize: buffer.length,
		};
	}

	const headersBuffer = buffer.subarray(0, separatorIdx);
	const bodyBuffer = buffer.subarray(separatorIdx + 4);
	const headersStr = headersBuffer.toString("utf-8");
	const lines = headersStr.split("\r\n");

	let method = "";
	let url = "";
	let status = isRequest ? 200 : 0;
	let statusText = isRequest ? "" : "Unknown";

	if (lines.length > 0) {
		const startLine = lines[0] || "";
		if (isRequest) {
			const parts = startLine.split(" ");
			method = parts[0] || method;
			url = parts[1] || url;
		} else {
			const parts = startLine.split(" ");
			status = parseInt(parts[1] || "200", 10);
			statusText = parts.slice(2).join(" ");
		}
	}

	const headers = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const colonIdx = line.indexOf(":");
		if (colonIdx > 0) {
			headers.push({
				name: line.substring(0, colonIdx).trim(),
				value: line.substring(colonIdx + 1).trim(),
			});
		}
	}

	return {
		status,
		statusText,
		method,
		url,
		headers,
		headersSize: separatorIdx + 4,
		body: bodyBuffer,
		bodySize: bodyBuffer.length,
	};
}

export class HarRecorder {
	private requests: Map<string, RequestRecord> = new Map();
	private isRecording: boolean = false;
	private firstEntry: boolean = true;
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

			if (type === "init" || type === "request") {
				const currentLen = req.requestBody?.length || 0;
				if (currentLen + chunk.length <= MAX_BUFFER_SIZE) {
					req.requestBody = Buffer.concat([
						req.requestBody || Buffer.alloc(0),
						chunk,
					]);
				}
			} else if (type === "response") {
				const currentLen = req.responseBody?.length || 0;
				if (currentLen + chunk.length <= MAX_BUFFER_SIZE) {
					req.responseBody = Buffer.concat([
						req.responseBody || Buffer.alloc(0),
						chunk,
					]);
				}
			}
		});

		Reactor.on("request:end", (id, update) => {
			if (!this.isRecording) return;
			const req = this.requests.get(id);
			if (!req) return;

			req.endTime = update.endTime;
			this.dumpEntry(req);
			this.requests.delete(id);
		});
	}

	public startRecording() {
		this.isRecording = true;
		this.firstEntry = true;
		this.requests.clear();
		const header = `{\n  "log": {\n    "version": "1.2",\n    "creator": {\n      "name": "Bun TUI Proxy",\n      "version": "1.0.0"\n    },\n    "entries": [\n`;
		fs.writeFileSync(this.outputFile, header);
	}

	public stopRecording() {
		this.isRecording = false;
		
		// Flush any pending partial requests
		for (const req of this.requests.values()) {
			this.dumpEntry(req);
		}
		this.requests.clear();

		const footer = `\n    ]\n  }\n}\n`;
		fs.appendFileSync(this.outputFile, footer);
	}

	public getStatus() {
		return this.isRecording;
	}

	private dumpEntry(req: RequestRecord) {
		try {
			const time = (req.endTime || Date.now()) - req.startTime;

			const parsedReq = parseHttpBuffer(req.requestBody || Buffer.alloc(0), true);
			const parsedRes = parseHttpBuffer(req.responseBody || Buffer.alloc(0), false);

			const requestMethod = req.method || parsedReq.method;
			const requestUrl = req.url || parsedReq.url;

			const entry = {
				startedDateTime: new Date(req.startTime).toISOString(),
				time: time > 0 ? time : 1,
				request: {
					method: requestMethod,
					url: requestUrl,
					httpVersion: "HTTP/1.1",
					cookies: [],
					headers: parsedReq.headers,
					queryString: [],
					headersSize: parsedReq.headersSize,
					bodySize: parsedReq.bodySize,
					...(parsedReq.body.length > 0
						? {
								postData: {
									mimeType:
										parsedReq.headers.find(
											(h) => h.name.toLowerCase() === "content-type",
										)?.value || "application/octet-stream",
									text: parsedReq.body.toString("base64"),
								},
							}
						: {}),
				},
				response: {
					status: parsedRes.status || 200,
					statusText: parsedRes.statusText || "OK",
					httpVersion: "HTTP/1.1",
					cookies: [],
					headers: parsedRes.headers,
					content: {
						size: parsedRes.bodySize,
						mimeType:
							parsedRes.headers.find(
								(h) => h.name.toLowerCase() === "content-type",
							)?.value || "text/plain",
						text: parsedRes.body.toString("base64"),
						encoding: "base64",
					},
					redirectURL: "",
					headersSize: parsedRes.headersSize,
					bodySize: parsedRes.bodySize,
				},
				cache: {},
				timings: {
					send: 0,
					wait: time,
					receive: 0,
				},
		};

		const entryStr = JSON.stringify(entry, null, 2);
		const prefix = this.firstEntry ? "" : ",\n";
		this.firstEntry = false;
		// Indent the entry block properly
		const indented = entryStr.replace(/^/gm, "      ");
		fs.appendFileSync(this.outputFile, `${prefix}${indented}`);
		} catch (err) {
			console.error("DUMP ERROR:", err);
		}
	}
}
