"""
A high-performance forward proxy server.

This script implements a lightweight forward proxy server to route traffic 
from clients (like WSL) through the host to the internet. 
It supports HTTP bridging and acts as a blind TCP relay for HTTPS/CONNECT traffic,
properly handling TCP half-closes to enable WebSockets and HTTP/2.
"""

import asyncio
import argparse
import logging
import urllib.parse
import socket
from pathlib import Path

def tune_socket(writer: asyncio.StreamWriter) -> None:
    sock = writer.get_extra_info('socket')
    if sock is not None:
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        except Exception as e:
            logger.debug("Failed to tune socket: %s", e)

# Configure logging
logger = logging.getLogger(__name__)


def setup_logging(log_file: Path) -> None:
    """Configures logging to both console and a file."""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(),
        ],
    )


async def transfer_data(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    log_prefix: str,
) -> None:
    """Transfers data blindly between a reader and a writer with TCP half-close support."""
    try:
        while not reader.at_eof():
            data = await reader.read(65536)
            if not data:
                break
            logger.debug("%s: Transferred %d bytes", log_prefix, len(data))
            writer.write(data)
            await writer.drain()
    except asyncio.CancelledError:
        pass
    except ConnectionError as e:
        logger.debug("%s: Connection error during transfer: %s", log_prefix, e)
    except OSError as e:
        if getattr(e, "winerror", None) == 64:
            logger.debug("%s: Connection reset (WinError 64) during transfer", log_prefix)
        else:
            logger.debug("%s: OS error during data transfer: %s", log_prefix, e)
    except Exception as e:
        logger.debug("%s: Error during data transfer: %s", log_prefix, e)
    finally:
        # Perform TCP half-close to signal EOF without severing the raw TCP socket.
        # This keeps the other direction alive for WebSockets/HTTP chunking.
        try:
            if writer.can_write_eof():
                writer.write_eof()
        except Exception as e:
            logger.debug("%s: Error during half-close (write_eof): %s", log_prefix, e)


async def handle_client(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
) -> None:
    """Handles a client connection."""
    try:
        request_line = await client_reader.readline()
        if not request_line:
            return

        method, target, version = request_line.decode().strip().split()
        logger.info("Request: %s %s %s", method, target, version)

        if method == "CONNECT":
            await handle_connect(
                client_reader, client_writer, target, version
            )
        else:
            await handle_http(
                client_reader, client_writer, method, target, version, request_line
            )
    except ConnectionError as e:
        logger.debug("Connection error handling client request: %s", e)
    except OSError as e:
        if getattr(e, "winerror", None) == 64:
            logger.debug("Connection reset (WinError 64) handling client request")
        else:
            logger.exception("OS error handling client request")
    except Exception:
        logger.exception("Error handling client request")
    finally:
        client_writer.close()
        try:
            await client_writer.wait_closed()
        except Exception as e:
            logger.debug("Error closing client writer: %s", e)


async def handle_http(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    method: str,
    target: str,
    version: str,
    request_line: bytes,
) -> None:
    """Handles a plain HTTP request."""
    headers = await read_headers(client_reader)
    host = headers.get("Host", "").split(":")[0]
    port = 80

    server_writer = None
    try:
        server_reader, server_writer = await asyncio.open_connection(host, port)
        server_writer.write(request_line)
        server_writer.write(headers.raw_bytes)
        await server_writer.drain()

        await asyncio.gather(
            transfer_data(client_reader, server_writer, f"Client -> {host}"),
            transfer_data(server_reader, client_writer, f"{host} -> Client"),
        )
    except ConnectionError as e:
        logger.debug("Connection error handling HTTP request for %s: %s", host, e)
    except OSError as e:
        if getattr(e, "winerror", None) == 64:
            logger.debug("Connection reset (WinError 64) handling HTTP request for %s", host)
        else:
            logger.exception("OS error handling HTTP request for %s", host)
    except Exception:
        logger.exception("Error handling HTTP request for %s", host)
    finally:
        if server_writer:
            server_writer.close()
            try:
                await server_writer.wait_closed()
            except Exception as e:
                logger.debug("Error closing server writer for %s: %s", host, e)


async def handle_connect(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    target: str,
    version: str,
) -> None:
    """Handles an HTTP CONNECT request purely as a TCP relay."""
    # Consume the remaining headers from the CONNECT request block 
    # so they do not leak into the transparent TLS tunnel
    await read_headers(client_reader)

    # Robust URL Parsing for Bun's non-standard CONNECT requests
    if target.startswith("http://") or target.startswith("https://"):
        parsed = urllib.parse.urlparse(target)
        host = parsed.hostname
        port = parsed.port or 443
    else:
        target = target.rstrip("/")
        if ":" in target:
            host, port_str = target.rsplit(":", 1)
            port = int(port_str)
        else:
            host = target
            port = 443

    server_writer = None
    try:
        # Establish connection to the actual target server FIRST
        server_reader, server_writer = await asyncio.open_connection(host, port)

        # Confirm to the client that the connection is ready (synchronously)
        client_writer.write(f"{version} 200 Connection Established\r\n\r\n".encode())
        await client_writer.drain()

        # Blindly transfer raw TCP data while supporting half-close
        await asyncio.gather(
            transfer_data(client_reader, server_writer, f"Client -> {host}"),
            transfer_data(server_reader, client_writer, f"{host} -> Client"),
        )
    except ConnectionError as e:
        logger.debug("Connection error handling CONNECT request for %s: %s", host, e)
    except OSError as e:
        if getattr(e, "winerror", None) == 64:
            logger.debug("Connection reset (WinError 64) handling CONNECT request for %s", host)
        else:
            logger.exception("OS error handling CONNECT request for %s", host)
    except Exception:
        logger.exception("Error handling CONNECT request for %s", host)
    finally:
        # Complete full socket termination ONLY after both directions finish
        if server_writer:
            server_writer.close()
            try:
                await server_writer.wait_closed()
            except Exception as e:
                logger.debug("Error fully closing server socket for %s: %s", host, e)


class Headers:
    """A class to parse and store HTTP headers."""

    def __init__(self, headers: list[tuple[str, str]]):
        self._headers = headers

    @classmethod
    async def from_reader(cls, reader: asyncio.StreamReader) -> "Headers":
        """Reads and parses headers from a stream reader."""
        headers = []
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            key, value = line.decode().strip().split(":", 1)
            headers.append((key.strip(), value.strip()))
        return cls(headers)

    def get(self, name: str, default: str = "") -> str:
        """Gets a header value by name."""
        return next((v for k, v in self._headers if k.lower() == name.lower()), default)

    @property
    def raw_bytes(self) -> bytes:
        """Returns the raw bytes of the headers."""
        return b"".join(
            f"{k}: {v}\r\n".encode() for k, v in self._headers
        ) + b"\r\n"


async def read_headers(reader: asyncio.StreamReader) -> Headers:
    """Reads headers from a stream reader."""
    return await Headers.from_reader(reader)


async def main() -> None:
    """The main function to start the proxy server."""
    parser = argparse.ArgumentParser(description="A robust forward proxy for WSL routing.")
    parser.add_argument(
        "--host", type=str, required=True, help="The host to bind the proxy to."
    )
    parser.add_argument(
        "--port", type=int, required=True, help="The port to bind the proxy to."
    )
    parser.add_argument(
        "--log-file",
        type=Path,
        required=True,
        help="The file to write logs to.",
    )
    args = parser.parse_args()

    setup_logging(args.log_file)

    server = await asyncio.start_server(
        handle_client,
        args.host,
        args.port,
    )

    addrs = ", ".join(str(sock.getsockname()) for sock in server.sockets)
    logger.info("Serving on %s", addrs)

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Proxy server shut down.")
