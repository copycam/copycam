// The text a Wi-Fi QR code carries, read into a network name and password.
// Pure string handling: the companion (server/wifi.js) and the browser reader
// (src/web/) find the code in a photo their own way, then both parse it here.

// Split on a separator that isn't backslash-escaped.
function splitUnescaped(text, sep) {
  const out = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const unescape = (v) => v.replace(/\\(.)/g, '$1');

// Parse the payload a Wi-Fi QR carries:
//   WIFI:S:<name>;T:<WPA|WEP|nopass>;P:<password>;H:<true|false>;;
// Fields may come in any order, and ; : , \ and " inside a value are
// backslash-escaped. Returns null for anything that isn't a Wi-Fi code.
export function parseWifiQr(payload) {
  if (typeof payload !== 'string') return null;
  const m = /^WIFI:/i.exec(payload.trim());
  if (!m) return null;

  const fields = {};
  for (const part of splitUnescaped(payload.trim().slice(m[0].length), ';')) {
    if (!part) continue;
    const at = splitUnescaped(part, ':');
    if (at.length < 2) continue;
    const key = at[0].toUpperCase();
    // a value may itself contain escaped colons, so re-join everything after
    // the first separator rather than taking only the second piece
    if (!(key in fields)) fields[key] = unescape(at.slice(1).join(':'));
  }

  const ssid = fields.S ?? '';
  if (!ssid) return null; // a code with no network name is not usable

  const type = (fields.T || '').toUpperCase();
  const security = type === 'WEP' ? 'WEP' : type === 'NOPASS' || (!type && !fields.P) ? 'nopass' : 'WPA';
  return {
    ssid,
    password: security === 'nopass' ? '' : (fields.P ?? ''),
    security,
    hidden: /^true$/i.test(fields.H || ''),
  };
}
