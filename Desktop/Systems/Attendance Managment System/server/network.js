const os = require('os');

const PRIVATE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Adapters that are usually virtual (not the network phones are on).
const VIRTUAL_RE = /vEthernet|WSL|VirtualBox|VMware|Docker|Hyper-V|Loopback|Bluetooth/i;

// Private IPv4 addresses of this machine, real Wi-Fi/Ethernet adapters first.
function lanAddresses() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal && PRIVATE_RE.test(info.address)) {
        found.push({ name, address: info.address, virtual: VIRTUAL_RE.test(name) });
      }
    }
  }
  return found.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

module.exports = { lanAddresses };
