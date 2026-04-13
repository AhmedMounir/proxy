import { parseArgs } from "node:util";
import { Box, render, Static, Text, useInput } from "ink";
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
		{ id: string; method: string; url: string; timestamp: Date }[]
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
					...prev,
					{
						id: req.id,
						method: req.method || "UNKNOWN",
						url: req.url || "UNKNOWN",
						timestamp: new Date(),
					},
				];
				// Keep history manageable but allow scrolling natural terminal history
				return updated.slice(-2000);
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
		<>
			<Static items={recentRequests}>
				{(req) => (
					<Box key={req.id}>
						<Text color="gray">[{req.timestamp.toLocaleTimeString()}]</Text>
						<Text> </Text>
						<Text color="magenta">{req.method.padEnd(8)}</Text>
						<Text>
							{req.url.length > 100
								? req.url.substring(0, 97) + "..."
								: req.url}
						</Text>
					</Box>
				)}
			</Static>

			{/* Pinned Footer */}
			<Box flexDirection="column" marginTop={1}>
				<Box borderStyle="single" borderColor="gray" flexDirection="column">
					<Box justifyContent="space-between" width="100%">
						<Text bold>
							<Text color="cyan">Bun Proxy</Text> • Listening:{" "}
							<Text color="green">
								{host}:{port}
							</Text>
						</Text>
						<Text>
							Connections: <Text color="yellow">{activeConnections}</Text>
						</Text>
					</Box>

					<Box marginTop={1}>
						<Text>
							[<Text color="blue">m</Text>] MITM:{" "}
							<Text color={mitmEnabled ? "green" : "red"}>
								{mitmEnabled ? "ON " : "OFF"}
							</Text>{" "}
							| [<Text color="blue">r</Text>] HAR Profile:{" "}
							<Text color={recording ? "green" : "red"}>
								{recording ? "ON " : "OFF"}
							</Text>{" "}
							| [<Text color="blue">q</Text>] Quit
						</Text>
					</Box>
				</Box>
			</Box>
		</>
	);
};

// Start Ink UI
render(<App />);

// Handle unexpected errors globally
process.on("uncaughtException", (_err) => {
	// Ignore to prevent crash for broken sockets
});
