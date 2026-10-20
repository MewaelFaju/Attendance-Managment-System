const QRCode = require('qrcode');
const { lanAddresses } = require('./network');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A public page (it reveals nothing beyond this machine's local address) that helps people open the app
// from a phone on the same network: a QR code, the typed address, and how to add it to the home screen.
async function renderConnectPage(port) {
  const urls = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${port}` }));
  const primary = urls[0];
  // margin 4 = the standard quiet zone; cameras struggle to lock on with less, especially from a screen.
  const qr = primary ? await QRCode.toString(primary.url, { type: 'svg', margin: 4, width: 300 }) : '';

  const body = primary
    ? `
      <div class="connect-qr" role="img" aria-label="QR code for ${escapeHtml(primary.url)}">${qr}</div>
      <p class="connect-url">${escapeHtml(primary.url)}</p>
      <p class="subtitle">Scan with the phone camera, or type the address into the browser.
        The phone must be on the same Wi-Fi as this computer.</p>
      ${
        urls.length > 1
          ? `<p class="subtitle">Other addresses of this computer:<br>${urls
              .slice(1)
              .map((u) => `${escapeHtml(u.url)} (${escapeHtml(u.name)})`)
              .join('<br>')}</p>`
          : ''
      }`
    : `<p class="message">This computer has no local network address. Connect it to the Wi-Fi or a network cable and reload.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open on a phone - Attendance System</title>
    <link rel="stylesheet" href="/style.css" />
    <script src="/theme.js"></script>
  </head>
  <body>
    <div class="screen">
      <div class="auth-container">
        <div class="auth-card connect-card">
          <div class="brand-block">
            <div class="brand-mark">A</div>
            <div>
              <p class="eyebrow">WORKFORCE MANAGER</p>
              <h1>Open on a phone</h1>
            </div>
          </div>
          ${body}
          <h3 class="connect-heading">Add it to the home screen</h3>
          <p class="subtitle"><strong>iPhone (Safari):</strong> Share, then Add to Home Screen.<br>
            <strong>Android (Chrome):</strong> menu (three dots), then Add to Home screen.</p>
          <h3 class="connect-heading">Can't connect?</h3>
          <ul class="connect-help">
            <li>The phone must be on the same Wi-Fi as this computer, with mobile data turned off.</li>
            <li>Use <strong>http</strong>, not https, and keep the <strong>:${escapeHtml(port)}</strong> at the end.</li>
            <li>This computer must be on, awake, and running the Attendance System.</li>
            <li>Security programs (for example 360 Total Security) may block other devices: allow
              <strong>node.exe</strong> in their firewall.</li>
            <li>Some routers block Wi-Fi devices from seeing each other. Look for
              <strong>AP isolation</strong> or <strong>client isolation</strong> in the router's Wi-Fi settings and turn it off.</li>
            <li>If it worked before and stopped, this computer's address may have changed. Reload this page on
              the computer to get the new one.</li>
          </ul>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { renderConnectPage };
