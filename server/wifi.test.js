// @vitest-environment node
import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseWifiQr, decodeWifi } from './wifi.js';

describe('parseWifiQr', () => {
  it('reads the usual payload', () => {
    expect(parseWifiQr('WIFI:T:WPA;S:HOMEBASE_5G;P:corgi-battery-42;;')).toEqual({
      ssid: 'HOMEBASE_5G',
      password: 'corgi-battery-42',
      security: 'WPA',
      hidden: false,
    });
  });

  it('accepts the fields in any order, and a hidden network', () => {
    const w = parseWifiQr('WIFI:P:pw;H:true;S:Net;T:WPA;;');
    expect(w).toMatchObject({ ssid: 'Net', password: 'pw', hidden: true });
  });

  it('unescapes the characters the format escapes', () => {
    // a password of  a;b:c\d,e  is written with each of those backslashed
    const w = parseWifiQr(String.raw`WIFI:S:My\;Net;T:WPA;P:a\;b\:c\\d\,e;;`);
    expect(w.ssid).toBe('My;Net');
    expect(w.password).toBe('a;b:c\\d,e');
  });

  it('handles an open network', () => {
    expect(parseWifiQr('WIFI:S:Cafe;T:nopass;;')).toMatchObject({ ssid: 'Cafe', password: '', security: 'nopass' });
    expect(parseWifiQr('WIFI:S:Cafe;;')).toMatchObject({ security: 'nopass' });
  });

  it('keeps WEP distinct from WPA', () => {
    expect(parseWifiQr('WIFI:S:Old;T:WEP;P:1234;;').security).toBe('WEP');
  });

  it('rejects anything that is not a Wi-Fi code', () => {
    for (const s of ['https://example.com', 'MECARD:N:Bob;;', '', 'WIFI:T:WPA;P:pw;;', null, 42]) {
      expect(parseWifiQr(s)).toBeNull();
    }
  });
});

// Draws a label: some printed text, and a QR of the given size turned by the
// given angle — roughly what the phone sends when someone frames a router.
async function label(payload, { size = 260, angle = 0, jpeg = 0.75 } = {}) {
  const qr = await loadImage(await QRCode.toBuffer(payload, { margin: 1, width: 600 }));
  const w = 1600;
  const h = 800;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#191919';
  ctx.font = '58px Arial';
  ['SSID: HOMEBASE_5G', 'Pass: corgi-battery-42'].forEach((t, i) => ctx.fillText(t, 70, 160 + i * 120));
  ctx.save();
  ctx.translate(1200, 400);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(qr, -size / 2, -size / 2, size, size);
  ctx.restore();
  return c.toBuffer('image/jpeg', jpeg);
}

describe('decodeWifi', () => {
  it('finds the Wi-Fi code on a photographed label', async () => {
    const wifi = await decodeWifi(await label('WIFI:T:WPA;S:HOMEBASE_5G;P:corgi-battery_42;;'));
    expect(wifi).toMatchObject({ ssid: 'HOMEBASE_5G', password: 'corgi-battery_42' });
  });

  it('still finds it when the code is small and turned', async () => {
    const wifi = await decodeWifi(await label('WIFI:T:WPA;S:Net;P:pw;;', { size: 170, angle: 28 }));
    expect(wifi).toMatchObject({ ssid: 'Net', password: 'pw' });
  });

  it('ignores a QR that is not about Wi-Fi', async () => {
    expect(await decodeWifi(await label('https://example.com/router'))).toBeNull();
  });

  it('returns null for a photo with no QR in it, and for junk input', async () => {
    const plain = createCanvas(600, 300);
    const ctx = plain.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 600, 300);
    ctx.fillStyle = '#000';
    ctx.font = '40px Arial';
    ctx.fillText('no code here', 40, 160);
    expect(await decodeWifi(plain.toBuffer('image/jpeg', 0.8))).toBeNull();
    expect(await decodeWifi(Buffer.from('not an image'))).toBeNull();
  });
});
