(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FloodFillEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function connectedMask(width, height, candidate, seeds) {
    const size = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
      throw new Error('invalid flood-fill dimensions');
    if (!candidate || candidate.length !== size || !seeds || seeds.length !== size)
      throw new Error('flood-fill masks do not match dimensions');

    const connected = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0, tail = 0;
    for (let i = 0; i < size; i++) {
      if (candidate[i] && seeds[i]) {
        connected[i] = 1;
        queue[tail++] = i;
      }
    }

    while (head < tail) {
      const index = queue[head++], y = Math.floor(index / width), x = index - y * width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!candidate[next] || connected[next]) continue;
        // ห้ามลอดผ่านมุมทแยงเมื่อเซลล์ด้านข้างทั้งสองเป็นที่แห้ง/คันกั้น
        if (dx && dy && !candidate[y * width + nx] && !candidate[ny * width + x]) continue;
        connected[next] = 1;
        queue[tail++] = next;
      }
    }
    return connected;
  }

  return { connectedMask };
});
