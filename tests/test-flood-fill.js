const assert = require('assert');
const { connectedMask } = require('../flood-fill.js');

const width = 8, height = 6;
const candidate = new Uint8Array(width * height);
const seeds = new Uint8Array(width * height);
const put = (x, y) => { candidate[y * width + x] = 1; };

// แอ่งที่เชื่อมกับคลอง
[[1, 1], [2, 1], [3, 1], [3, 2], [4, 2]].forEach(([x, y]) => put(x, y));
seeds[1 * width + 1] = 1;
// แอ่งต่ำอีกแห่ง แต่ไม่มีทางน้ำเชื่อม
[[6, 3], [6, 4], [7, 4]].forEach(([x, y]) => put(x, y));

const result = connectedMask(width, height, candidate, seeds);
assert.strictEqual(result[4 + 2 * width], 1, 'connected floodplain should be retained');
assert.strictEqual(result[6 + 3 * width], 0, 'isolated depression should be removed');

// เซลล์แตะกันเฉพาะมุม โดยสองด้านเป็นที่แห้ง ต้องไม่รั่วผ่านมุม
const diagonal = new Uint8Array(9), diagonalSeeds = new Uint8Array(9);
diagonal[0] = diagonal[4] = 1; diagonalSeeds[0] = 1;
assert.strictEqual(connectedMask(3, 3, diagonal, diagonalSeeds)[4], 0);

console.log('flood-fill connectivity and diagonal barrier tests: PASS');
