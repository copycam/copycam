import fs from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

// Resolve TLS material by precedence:
//   1. TLS_CERT_FILE + TLS_KEY_FILE env vars (any PEM pair, e.g. Let's Encrypt)
//   2. custom.crt + custom.key next to the key file (drop-in, e.g. from mkcert)
//   3. auto-generated self-signed cert (persisted, regenerated when expiring)
// With a trusted cert (1 or 2) phones connect with no warning; set CC_DOMAIN
// so the QR uses the certificate's hostname instead of the raw LAN IP.
export async function loadTlsMaterial(certFile, ips) {
  const { TLS_CERT_FILE, TLS_KEY_FILE } = process.env;
  if (TLS_CERT_FILE && TLS_KEY_FILE) {
    return {
      cert: fs.readFileSync(TLS_CERT_FILE, 'utf8'),
      key: fs.readFileSync(TLS_KEY_FILE, 'utf8'),
      source: `env (${TLS_CERT_FILE})`,
    };
  }
  const dir = path.dirname(certFile);
  const customCert = path.join(dir, 'custom.crt');
  const customKey = path.join(dir, 'custom.key');
  if (fs.existsSync(customCert) && fs.existsSync(customKey)) {
    return {
      cert: fs.readFileSync(customCert, 'utf8'),
      key: fs.readFileSync(customKey, 'utf8'),
      source: `custom (${customCert})`,
    };
  }
  return { ...(await loadOrCreateCert(certFile, ips)), source: 'self-signed' };
}

// Self-signed TLS for the LAN-facing server. This exists to satisfy phones
// with HTTPS-Only mode (iOS Safari) and to encrypt the page load; the real
// payload protection is the app-layer E2E crypto (see SECURITY.md). The cert
// is untrusted by design — phones show a one-time "not private" warning.
export async function loadOrCreateCert(certFile, ips) {
  if (fs.existsSync(certFile)) {
    try {
      const stored = JSON.parse(fs.readFileSync(certFile, 'utf8'));
      if (stored.key && stored.cert && Date.parse(stored.expires) > Date.now() + 24 * 3600 * 1000) {
        return stored;
      }
    } catch {
      // corrupt or expired — regenerate
    }
  }
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'CopyCam' }], {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' }, // DNS
          ...ips.map((ip) => ({ type: 7, ip })), // IP
        ],
      },
    ],
  });
  const expires = new Date(Date.now() + 364 * 24 * 3600 * 1000).toISOString();
  const record = { key: pems.private, cert: pems.cert, expires };
  fs.mkdirSync(path.dirname(certFile), { recursive: true });
  fs.writeFileSync(certFile, JSON.stringify(record), { mode: 0o600 });
  return record;
}
