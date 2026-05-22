/**
 * CRC32 公共模块
 * _image-utils.js 和 _pack-utils.js 共用
 */

let _crc32Table = null;

function crc32Table() {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crc32Table[i] = c >>> 0;
  }
  return _crc32Table;
}

/**
 * 计算Buffer的CRC32校验值
 * @param {Buffer} buf
 * @returns {number}
 */
export function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = crc32Table();
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
