import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as forge from "node-forge";

export class CAManager {
	private caCert: forge.pki.Certificate;
	private caKey: forge.pki.PrivateKey;
	private certCache: Map<string, { key: string; cert: string }> = new Map();

	constructor(caCertPath: string, caKeyPath: string) {
		const certPem = readFileSync(resolve(caCertPath), "utf8");
		const keyPem = readFileSync(resolve(caKeyPath), "utf8");

		this.caCert = forge.pki.certificateFromPem(certPem);
		this.caKey = forge.pki.privateKeyFromPem(keyPem);
	}

	public getCertificateForHost(host: string): { key: string; cert: string } {
		// Strip out the port if present and wildcard the lowest subdomain level
		const parts = host.split(":")[0]?.split(".");
		let certHost = host.split(":")[0]!;
		if (parts && parts.length > 2) {
			certHost = `*.${parts.slice(1).join(".")}`;
		}

		if (this.certCache.has(certHost)) {
			return this.certCache.get(certHost)!;
		}

		const keys = forge.pki.rsa.generateKeyPair(2048);
		const cert = forge.pki.createCertificate();

		cert.publicKey = keys.publicKey;
		cert.serialNumber = `${Math.floor(Math.random() * 100000)}`;

		cert.validity.notBefore = new Date();
		cert.validity.notBefore.setFullYear(
			cert.validity.notBefore.getFullYear() - 1,
		);
		cert.validity.notAfter = new Date();
		cert.validity.notAfter.setFullYear(
			cert.validity.notAfter.getFullYear() + 1,
		);

		const attrs = [
			{
				name: "commonName",
				value: certHost,
			},
		];

		cert.setSubject(attrs);
		cert.setIssuer(this.caCert.subject.attributes);
		cert.setExtensions([
			{
				name: "basicConstraints",
				cA: false,
			},
			{
				name: "keyUsage",
				keyCertSign: false,
				digitalSignature: true,
				nonRepudiation: true,
				keyEncipherment: true,
				dataEncipherment: true,
			},
			{
				name: "extKeyUsage",
				serverAuth: true,
				clientAuth: true,
				codeSigning: true,
				emailProtection: true,
				timeStamping: true,
			},
			{
				name: "subjectAltName",
				altNames: [
					{
						type: 2, // DNS
						value: certHost,
					},
					{
						type: 2,
						value: host.split(":")[0], // always include exact host
					},
				],
			},
		]);

		// Sign mathematically with our CA Key
		cert.sign(this.caKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());

		const generatedData = {
			key: forge.pki.privateKeyToPem(keys.privateKey),
			cert: forge.pki.certificateToPem(cert),
		};

		this.certCache.set(certHost, generatedData);
		return generatedData;
	}
}
