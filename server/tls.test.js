// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { loadOrCreateCert, loadTlsMaterial } from './tls.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copycam-tls-'));
const certFile = path.join(tmp, 'tls.json');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('self-signed TLS cert', () => {
  it('generates a PEM keypair with the LAN IP in SANs', async () => {
    const { key, cert } = await loadOrCreateCert(certFile, ['192.168.1.23']);
    expect(key).toContain('PRIVATE KEY');
    expect(cert).toContain('BEGIN CERTIFICATE');
  });

  it('reuses the stored cert on subsequent runs', async () => {
    const first = JSON.parse(fs.readFileSync(certFile, 'utf8'));
    const again = await loadOrCreateCert(certFile, ['192.168.1.23']);
    expect(again.cert).toBe(first.cert);
  });

  it('regenerates when the stored record is corrupt', async () => {
    fs.writeFileSync(certFile, 'not json');
    const fresh = await loadOrCreateCert(certFile, ['10.0.0.5']);
    expect(fresh.cert).toContain('BEGIN CERTIFICATE');
  });
});

describe('loadTlsMaterial precedence', () => {
  afterEach(() => {
    delete process.env.TLS_CERT_FILE;
    delete process.env.TLS_KEY_FILE;
    fs.rmSync(path.join(tmp, 'custom.crt'), { force: true });
    fs.rmSync(path.join(tmp, 'custom.key'), { force: true });
  });

  it('prefers env-provided cert files', async () => {
    const c = path.join(tmp, 'env.crt');
    const k = path.join(tmp, 'env.key');
    fs.writeFileSync(c, 'ENV-CERT');
    fs.writeFileSync(k, 'ENV-KEY');
    process.env.TLS_CERT_FILE = c;
    process.env.TLS_KEY_FILE = k;

    const tls = await loadTlsMaterial(certFile, []);
    expect(tls.cert).toBe('ENV-CERT');
    expect(tls.key).toBe('ENV-KEY');
    expect(tls.source).toContain('env');
  });

  it('falls back to custom.crt/custom.key next to the key file', async () => {
    fs.writeFileSync(path.join(tmp, 'custom.crt'), 'CUSTOM-CERT');
    fs.writeFileSync(path.join(tmp, 'custom.key'), 'CUSTOM-KEY');

    const tls = await loadTlsMaterial(certFile, []);
    expect(tls.cert).toBe('CUSTOM-CERT');
    expect(tls.source).toContain('custom');
  });

  it('self-signs when nothing is provided', async () => {
    const tls = await loadTlsMaterial(certFile, ['192.168.1.23']);
    expect(tls.cert).toContain('BEGIN CERTIFICATE');
    expect(tls.source).toBe('self-signed');
  });
});
