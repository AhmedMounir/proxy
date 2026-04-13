import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Reactor } from "../src/engine/reactor";
import { HarRecorder } from "../src/trace/har-recorder";

describe("HarRecorder", () => {
	let recorder: HarRecorder;
	const testFile = path.join(process.cwd(), "test-trace.har");

	beforeEach(() => {
		// Clear all listeners to avoid side effects between tests
		Reactor.removeAllListeners();
		recorder = new HarRecorder(testFile);
	});

	afterEach(() => {
		if (fs.existsSync(testFile)) {
			fs.unlinkSync(testFile);
		}
	});

	it("should start with isRecording = false", () => {
		expect(recorder.getStatus()).toBe(false);
	});

	it("should update status when startRecording and stopRecording are called", () => {
		recorder.startRecording();
		expect(recorder.getStatus()).toBe(true);

		recorder.stopRecording();
		expect(recorder.getStatus()).toBe(false);
	});

	it("should not record when isRecording is false", () => {
		recorder.startRecording(); // Start first so we have the header
		recorder.stopRecording(); // Immediately stop

		// Fire an event while NOT recording
		Reactor.emit("request:start", {
			id: "test-req-1",
			method: "GET",
			url: "http://example.com",
			startTime: Date.now(),
		});

		expect(fs.existsSync(testFile)).toBe(true);
		const harContent = fs.readFileSync(testFile, "utf-8");
		const harData = JSON.parse(harContent);
		expect(harData.log.entries.length).toBe(0);
	});

	it("should record request events and dump valid HAR file", () => {
		recorder.startRecording();

		const startTime = Date.now();
		Reactor.emit("request:start", {
			id: "test-req-2",
			method: "POST",
			url: "http://example.com/api",
			startTime: startTime,
		});

		// Test request chunk
		Reactor.emit(
			"request:chunk",
			"test-req-2",
			Buffer.from("POST /api HTTP/1.1\r\nHost: example.com\r\n\r\nrequest-body"),
			"request",
		);

		// Test response chunk
		Reactor.emit(
			"request:chunk",
			"test-req-2",
			Buffer.from("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\nresponse-body"),
			"response",
		);

		// End request
		Reactor.emit("request:end", "test-req-2", {
			endTime: startTime + 100,
		});

		recorder.stopRecording();

		expect(fs.existsSync(testFile)).toBe(true);
		const harContent = fs.readFileSync(testFile, "utf-8");
		const harData = JSON.parse(harContent);

		expect(harData.log.version).toBe("1.2");
		expect(harData.log.entries.length).toBe(1);

		const entry = harData.log.entries[0];
		expect(entry.request.method).toBe("POST");
		expect(entry.request.url).toBe("http://example.com/api");
		expect(entry.request.bodySize).toBe(Buffer.from("request-body").length);
		expect(entry.response.bodySize).toBe(Buffer.from("response-body").length);
		expect(entry.time).toBeGreaterThan(0);
	});

	it("should handle missing request in chunks/end events gracefully", () => {
		recorder.startRecording();

		// Emit chunk/end for non-existent request
		Reactor.emit(
			"request:chunk",
			"non-existent",
			Buffer.from("data"),
			"request",
		);
		Reactor.emit("request:end", "non-existent", { endTime: Date.now() });

		recorder.stopRecording();

		expect(fs.existsSync(testFile)).toBe(true);
		const harContent = fs.readFileSync(testFile, "utf-8");
		const harData = JSON.parse(harContent);
		expect(harData.log.entries.length).toBe(0);
	});
});
