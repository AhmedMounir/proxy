import { parseArgs } from "node:util";
import { Box, render, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { Reactor } from "../engine/reactor";
import { CAManager } from "../proxy/ca";
import { ProxyServer } from "../proxy/server";
import { HarRecorder } from "../trace/har-recorder";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		port: {
			type: "string",
			short: "p",
			default: "8080",
		},
		host: {
			type: "string",
			short: "h",
			default: "0.0.0.0",
		},
	},
});

const ca = new CAManager("./ca.pem", "./ca-key.pem");
const server = new ProxyServer(ca);
const recorder = new HarRecorder("./trace.har");

const App = () => {
	const [port] = useState(parseInt(values.port || "8080", 10));
	const [host] = useState(values.host || "0.0.0.0");
	const [activeConnections, setActiveConnections] = useState(0);
	const [mitmEnabled, setMitmEnabled] = useState(false);
	const [recording, setRecording] = useState(false);
	const [recentRequests, setRecentRequests] = useState<
		{ id: string; method: string; url: string }[]
	>([]);

	useEffect(() => {
		server.start(port, host).catch((err) => {
			console.error("Failed to start server:", err);
			process.exit(1);
		});

		const handleConn = (count: number) => setActiveConnections(count);
		const handleReq = (
			req: Partial<{ method: string; url: string }> & { id: string },
		) => {
			setRecentRequests((prev) => {
				const updated = [
					{
						id: req.id,
						method: req.method || "UNKNOWN",
						url: req.url || "UNKNOWN",
					},
					...prev,
				];
				return updated.slice(0, 10);
			});
		};

		Reactor.on("connection:active", handleConn);
		Reactor.on("request:start", handleReq);

		return () => {
			server.stop();
		};
	}, [port, host]);

	useInput((input, _key) => {
		if (input === "m") {
			server.mitmEnabled = !server.mitmEnabled;
			setMitmEnabled(server.mitmEnabled);
		}
		if (input === "r") {
			if (recording) {
				recorder.stopRecording();
				setRecording(false);
			} else {
				recorder.startRecording();
				setRecording(true);
			}
		}
		if (input === "q") {
			server.stop();
			process.exit(0);
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box
				borderStyle="round"
				borderColor="cyan"
				padding={1}
				flexDirection="column"
			>
				<Text bold color="cyan">
					Bun Proxy Server Dashboard
				</Text>
				<Text>
					Listening:{" "}
					<Text color="green">
						{host}:{port}
					</Text>
				</Text>
				<Text>
					Active Connections: <Text color="yellow">{activeConnections}</Text>
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text bold>Controls:</Text>
				<Text>
					[<Text color="blue">m</Text>] Toggle MITM:
					<Text color={mitmEnabled ? "green" : "red"}>
						{" "}
						{mitmEnabled ? "ENABLED" : "DISABLED"}
					</Text>
				</Text>
				<Text>
					[<Text color="blue">r</Text>] Toggle HAR Trace:
					<Text color={recording ? "green" : "red"}>
						{" "}
						{recording ? "RECORDING" : "STOPPED"}
					</Text>
				</Text>
				<Text>
					[<Text color="blue">q</Text>] Quit
				</Text>
			</Box>

			<Box
				marginTop={1}
				flexDirection="column"
				borderStyle="single"
				borderColor="gray"
				padding={1}
			>
				<Text bold>Recent Requests</Text>
				{recentRequests.length === 0 && (
					<Text color="gray">No requests yet...</Text>
				)}
				{recentRequests.map((req) => (
					<Text key={req.id}>
						<Text color="magenta">{req.method.padEnd(8)}</Text>{" "}
						{req.url.substring(0, 70) + (req.url.length > 70 ? "..." : "")}
					</Text>
				))}
			</Box>
		</Box>
	);
};

// Start Ink UI
render(<App />);

// Handle unexpected errors globally
process.on("uncaughtException", (_err) => {
	// Ignore to prevent crash for broken sockets
});
