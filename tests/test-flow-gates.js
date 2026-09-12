const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', 'data', 'river.geojson'),
  path.join(__dirname, '..', '..', 'flood-depth-pc-operations', 'data', 'river.geojson')
];

function crossingsAt(coords, lat) {
  const values = [];
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1], b = coords[i];
    if (lat < Math.min(a[1], b[1]) || lat > Math.max(a[1], b[1]) || a[1] === b[1]) continue;
    const t = (lat - a[1]) / (b[1] - a[1]);
    if (t >= 0 && t <= 1) values.push(a[0] + t * (b[0] - a[0]));
  }
  return values;
}

function gatesAt(data, lat, lon, stage, totalQ) {
  const left = crossingsAt(data.features[1].geometry.coordinates, lat);
  const right = crossingsAt(data.features[2].geometry.coordinates, lat);
  assert(left.length && right.length, `missing both banks at latitude ${lat}`);
  const bankA = Math.max(...left), bankB = Math.min(...right);
  const west = Math.min(bankA, bankB), east = Math.max(bankA, bankB);
  if (lon < west) return totalQ >= 1680;
  if (lon > east) return stage >= 8.30;
  return true;
}

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(data.features.length, 4, `${file}: expected four river lines`);
  assert(data.features.every(feature => feature.geometry.type === 'LineString'));

  const lat = 7.00;
  const left = crossingsAt(data.features[1].geometry.coordinates, lat);
  const right = crossingsAt(data.features[2].geometry.coordinates, lat);
  const west = Math.min(Math.max(...left), Math.min(...right));
  const east = Math.max(Math.max(...left), Math.min(...right));

  assert.strictEqual(gatesAt(data, lat, west - 0.001, 8.17, 1679), false);
  assert.strictEqual(gatesAt(data, lat, west - 0.001, 8.17, 1680), true);
  assert.strictEqual(gatesAt(data, lat, east + 0.001, 8.29, 3000), false);
  assert.strictEqual(gatesAt(data, lat, east + 0.001, 8.30, 1000), true);
  assert.strictEqual(gatesAt(data, lat, (west + east) / 2, 7.00, 0), true);
}

console.log('river geometry and independent flow-gate thresholds: PASS');
