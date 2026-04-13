import { EventEmitter } from "node:events";

export interface RequestRecord {
	id: string;
	method: string;
	url: string;
	startTime: number;
	endTime?: number;
	requestHeaders?: Record<string, string | string[] | undefined>;
	requestBody?: Buffer;
	status?: number;
	responseHeaders?: Record<string, string | string[] | undefined>;
	responseBody?: Buffer;
	protocol: "http" | "https" | "connect";
	error?: string;
}

export type ReactorEvents = {
	"request:start": (record: Partial<RequestRecord> & { id: string }) => void;
	"request:chunk": (
		id: string,
		chunk: Buffer,
		type: "init" | "request" | "response",
	) => void;
	"request:end": (id: string, recordUpdate: Partial<RequestRecord>) => void;
	"request:error": (id: string, error: Error) => void;
	"connection:active": (count: number) => void;
};

class ReactorType extends EventEmitter {
	public override emit<K extends keyof ReactorEvents>(
		event: K,
		...args: Parameters<ReactorEvents[K]>
	): boolean {
		return super.emit(event, ...args);
	}

	public override on<K extends keyof ReactorEvents>(
		event: K,
		listener: ReactorEvents[K],
	): this {
		return super.on(event, listener);
	}
}

export const Reactor = new ReactorType();
