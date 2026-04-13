
"""
A forward proxy server with SSL/TLS interception.

This script implements a forward proxy server that can intercept and log HTTP and
HTTPS traffic. It uses the asyncio library for handling concurrent client
connections and the cryptography library for generating TLS certificates on the fly.
"""

import asyncio
import argparse
import logging
import ssl
from pathlib import Path
from typing import Tuple
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

# Configure logging
logger = logging.getLogger(__name__)


def setup_logging(log_file: Path) -> None:
    """
    Configures logging to both console and a file.

    Args:
        log_file: The path to the log file.
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(),
        ],
    )


class CertificateAuthority:
    """
    Manages the Certificate Authority (CA) for signing certificates.
    """

    def __init__(self, ca_file: Path, key_file: Path):
        self.ca_file = ca_file
        self.key_file = key_file
        self.ca_cert, self.ca_key = self._load_or_create_ca()

    def _load_or_create_ca(self) -> Tuple[x509.Certificate, rsa.RSAPrivateKey]:
        """
        Loads an existing CA certificate and key or creates them if they don't exist.

        Returns:
            A tuple containing the CA certificate and private key.
        """
        if self.ca_file.exists() and self.key_file.exists():
            logger.info("Loading existing CA certificate and key.")
            with self.key_file.open("rb") as f:
                ca_key = serialization.load_pem_private_key(f.read(), password=None)
            with self.ca_file.open("rb") as f:
                ca_cert = x509.load_pem_x509_certificate(f.read())
        else:
            logger.info("Generating new CA certificate and key.")
            ca_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )
            subject = issuer = x509.Name(
                [
                    x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                    x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "California"),
                    x509.NameAttribute(NameOID.LOCALITY_NAME, "San Francisco"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "My Proxy"),
                    x509.NameAttribute(NameOID.COMMON_NAME, "My Proxy CA"),
                ]
            )
            ca_cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(issuer)
                .public_key(ca_key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(datetime.now(timezone.utc))
                .not_valid_after(datetime.now(timezone.utc) + timedelta(days=3650))
                .add_extension(
                    x509.BasicConstraints(ca=True, path_length=None),
                    critical=True,
                )
                .sign(ca_key, hashes.SHA256())
            )
            with self.key_file.open("wb") as f:
                f.write(
                    ca_key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.TraditionalOpenSSL,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )
            with self.ca_file.open("wb") as f:
                f.write(ca_cert.public_bytes(serialization.Encoding.PEM))
        return ca_cert, ca_key

    async def generate_server_certificate(self, hostname: str) -> Tuple[Path, Path]:
        """
        Generates a certificate for the given hostname, signed by the CA.

        Args:
            hostname: The hostname for the certificate.

        Returns:
            A tuple containing the paths to the generated certificate and key files.
        """
        cert_path = Path(f"{hostname}.pem")
        key_path = Path(f"{hostname}-key.pem")

        if cert_path.exists() and key_path.exists():
            return cert_path, key_path

        logger.info("Generating certificate for %s", hostname)
        
        def _generate_cert():
            server_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
            )
            subject = x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, hostname),
                ]
            )
            server_cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(self.ca_cert.subject)
                .public_key(server_key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(datetime.now(timezone.utc))
                .not_valid_after(datetime.now(timezone.utc) + timedelta(days=365))
                .add_extension(
                    x509.SubjectAlternativeName([x509.DNSName(hostname)]),
                    critical=False,
                )
                .sign(self.ca_key, hashes.SHA256())
            )

            with key_path.open("wb") as f:
                f.write(
                    server_key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.TraditionalOpenSSL,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )
            with cert_path.open("wb") as f:
                f.write(server_cert.public_bytes(serialization.Encoding.PEM))
            
            return cert_path, key_path

        return await asyncio.to_thread(_generate_cert)


async def transfer_data(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    log_prefix: str,
) -> None:
    """
    Transfers data between a reader and a writer, logging the traffic.

    Args:
        reader: The stream reader.
        writer: The stream writer.
        log_prefix: The prefix for log messages.
    """
    try:
        while not reader.at_eof():
            data = await reader.read(4096)
            if not data:
                break
            logger.info("%s: %s", log_prefix, data)
            writer.write(data)
            await writer.drain()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Error during data transfer")
    finally:
        writer.close()
        await writer.wait_closed()


async def handle_client(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    ca: CertificateAuthority,
) -> None:
    """
    Handles a client connection.

    Args:
        client_reader: The client's stream reader.
        client_writer: The client's stream writer.
        ca: The CertificateAuthority instance.
    """
    try:
        request_line = await client_reader.readline()
        if not request_line:
            return

        method, target, version = request_line.decode().strip().split()
        logger.info("Request: %s %s %s", method, target, version)

        if method == "CONNECT":
            await handle_connect(
                client_reader, client_writer, target, version, ca
            )
        else:
            await handle_http(
                client_reader, client_writer, method, target, version, request_line
            )
    except Exception:
        logger.exception("Error handling client request")
    finally:
        client_writer.close()
        await client_writer.wait_closed()


async def handle_http(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    method: str,
    target: str,
    version: str,
    request_line: bytes,
) -> None:
    """
    Handles a plain HTTP request.

    Args:
        client_reader: The client's stream reader.
        client_writer: The client's stream writer.
        method: The HTTP method.
        target: The request target.
        version: The HTTP version.
        request_line: The full request line.
    """
    headers = await read_headers(client_reader)
    host = headers.get("Host", "").split(":")[0]
    port = 80

    try:
        server_reader, server_writer = await asyncio.open_connection(host, port)
        server_writer.write(request_line)
        server_writer.write(headers.raw_bytes)
        await server_writer.drain()

        await asyncio.gather(
            transfer_data(client_reader, server_writer, f"Client -> {host}"),
            transfer_data(server_reader, client_writer, f"{host} -> Client"),
        )
    except Exception:
        logger.exception("Error handling HTTP request for %s", host)


async def handle_connect(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    target: str,
    version: str,
    ca: CertificateAuthority,
) -> None:
    """
    Handles an HTTP CONNECT request for SSL/TLS interception.

    Args:
        client_reader: The client's stream reader.
        client_writer: The client's stream writer.
        target: The target host and port.
        version: The HTTP version.
        ca: The CertificateAuthority instance.
    """
    host, port_str = target.split(":")
    port = int(port_str)

    try:
        # Respond to the CONNECT request
        client_writer.write(f"{version} 200 Connection Established\r\n\r\n".encode())
        await client_writer.drain()

        # Generate server certificate
        cert_path, key_path = await ca.generate_server_certificate(host)

        # Create SSL context for the client-side connection
        client_ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        client_ssl_context.load_cert_chain(certfile=cert_path, keyfile=key_path)

        # Wrap the client connection with SSL/TLS
        client_reader, client_writer = await start_tls(
            client_reader, client_writer, client_ssl_context
        )

        # Connect to the actual server
        server_reader, server_writer = await asyncio.open_connection(
            host, port, ssl=True
        )

        # Transfer data between client and server
        await asyncio.gather(
            transfer_data(client_reader, server_writer, f"Client -> {host}"),
            transfer_data(server_reader, client_writer, f"{host} -> Client"),
        )
    except Exception:
        logger.exception("Error handling CONNECT request for %s", host)


async def start_tls(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    ssl_context: ssl.SSLContext,
) -> Tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """
    Starts TLS on an existing connection.

    Args:
        reader: The stream reader.
        writer: The stream writer.
        ssl_context: The SSL context.

    Returns:
        A new reader and writer for the TLS-encrypted connection.
    """
    loop = asyncio.get_running_loop()
    new_reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(new_reader)
    transport = writer.transport
    
    tls_transport = await loop.start_tls(
        transport, protocol, ssl_context, server_side=True
    )
    
    new_writer = asyncio.StreamWriter(tls_transport, protocol, new_reader, loop)
    return new_reader, new_writer


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
    """
    Reads headers from a stream reader.

    Args:
        reader: The stream reader.

    Returns:
        A Headers object.
    """
    return await Headers.from_reader(reader)


async def main() -> None:
    """
    The main function to start the proxy server.
    """
    parser = argparse.ArgumentParser(description="A forward proxy with SSL/TLS interception.")
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

    ca = CertificateAuthority(
        ca_file=Path("ca.pem"),
        key_file=Path("ca-key.pem"),
    )

    server = await asyncio.start_server(
        lambda r, w: handle_client(r, w, ca),
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
