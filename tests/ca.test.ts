import { describe, expect, test } from "bun:test";
import * as forge from "node-forge";
import { CAManager } from "../src/proxy/ca";

describe("CAManager", () => {
	test("should generate and cache certificate for a host", () => {
		const ca = new CAManager("./ca.pem", "./ca-key.pem");

		// Test generation and caching
		const certData1 = ca.getCertificateForHost("example.com");
		const certData2 = ca.getCertificateForHost("example.com");

		expect(certData1).toBeDefined();
		expect(certData1.cert).toBeDefined();
		expect(certData1.key).toBeDefined();

		// Instance should be identical (served from cache)
		expect(certData1).toBe(certData2);

		// Test subdomain wildcard logic
		const subCert1 = ca.getCertificateForHost("app.example.org");
		const subCert2 = ca.getCertificateForHost("api.example.org");

		// Both should map to *.example.org and use the same cached certificate
		expect(subCert1).toBe(subCert2);

		// Verify certificate characteristics
		const cert = forge.pki.certificateFromPem(certData1.cert);
		expect(cert.subject.getField("CN").value).toBe("example.com");

		const subCert = forge.pki.certificateFromPem(subCert1.cert);
		expect(subCert.subject.getField("CN").value).toBe("*.example.org");

		// Test port stripping logic
		const withPort = ca.getCertificateForHost("example.com:443");
		expect(withPort).toBe(certData1); // Should match cache for example.com
	});
});
