// Read a single top-level cart.json field.
//
// Usage:
//   tools/v8cli scripts/cart-manifest-field.js cart/foo/cart.json icon

const argv = process.argv.slice(1);
const manifestPath = argv[0];
const fieldName = argv[1];

if (!manifestPath || !fieldName) {
  __writeStderr('[cart-manifest-field] usage: cart-manifest-field.js <cart.json> <field>\n');
  __exit(1);
}

const raw = __fs_read(manifestPath);
if (raw === null) {
  __writeStderr('[cart-manifest-field] cannot read ' + manifestPath + '\n');
  __exit(1);
}

let manifest;
try {
  manifest = JSON.parse(raw);
} catch (e) {
  __writeStderr('[cart-manifest-field] bad json in ' + manifestPath + ': ' + (e && e.message) + '\n');
  __exit(1);
}

let value = manifest;
for (const part of fieldName.split('.')) {
  if (value === undefined || value === null) break;
  value = value[part];
}
if (value === undefined || value === null) __exit(0);
if (typeof value === 'string') {
  __writeStdout(value + '\n');
} else if (typeof value === 'number' || typeof value === 'boolean') {
  __writeStdout(String(value) + '\n');
} else {
  __writeStdout(JSON.stringify(value) + '\n');
}
