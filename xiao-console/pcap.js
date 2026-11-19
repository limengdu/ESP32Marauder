const encoder = new TextEncoder();
const BEGIN = encoder.encode('[BUF/BEGIN]');
const CLOSE = encoder.encode('[BUF/CLOSE]');

function matches(bytes, marker, offset = 0) {
  return marker.every((value, index) => bytes[offset + index] === value);
}

function markerIndex(bytes, marker) {
  for (let index = 0; index <= bytes.length - marker.length; index += 1) {
    if (matches(bytes, marker, index)) return index;
  }
  return -1;
}

/**
 * Separate console text and PCAP records in Marauder's serial buffer blocks.
 * 从 Marauder 串口缓冲分块中分离终端文字与 PCAP 记录。
 */
export class SerialPcapDecoder {
  constructor({ onText, onHeader, onRecord, onError }) {
    Object.assign(this, { onText, onHeader, onRecord, onError });
    this.buffer = new Uint8Array();
    this.inside = false;
    this.header = null;
    this.discard = false;
  }

  newFile() {
    if (this.inside) throw new Error('A serial capture block is still open');
    this.header = null;
    this.discard = false;
  }

  fail(message) {
    if (!this.discard) this.onError(message);
    this.discard = true;
  }

  consume(count) {
    const bytes = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return bytes;
  }

  push(bytes) {
    const joined = new Uint8Array(this.buffer.length + bytes.length);
    joined.set(this.buffer);
    joined.set(bytes, this.buffer.length);
    this.buffer = joined;
    for (;;) {
      if (!this.inside) {
        const index = markerIndex(this.buffer, BEGIN);
        if (index < 0) {
          let retained = Math.min(BEGIN.length - 1, this.buffer.length);
          while (retained && !BEGIN.slice(0, retained).every((value, i) => this.buffer[this.buffer.length - retained + i] === value)) retained -= 1;
          const length = this.buffer.length - retained;
          if (length) this.onText(this.consume(length));
          return;
        }
        if (index) this.onText(this.consume(index));
        this.consume(BEGIN.length);
        this.inside = true;
        this.blockHeader = null;
        this.blockRecords = [];
      }
      if (this.discard) {
        const index = markerIndex(this.buffer, CLOSE);
        if (index < 0) {
          if (this.buffer.length >= CLOSE.length) this.consume(this.buffer.length - CLOSE.length + 1);
          return;
        }
        this.consume(index + CLOSE.length);
        if (this.blockHeader) this.header = null;
        this.discard = false;
        this.inside = false;
        continue;
      }
      if (!this.header) {
        if (this.buffer.length < 24) return;
        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 24);
        const snapshot = view.getUint32(16, true);
        if (view.getUint32(0, true) !== 0xa1b2c3d4 || view.getUint16(4, true) !== 2 || view.getUint16(6, true) !== 4 || view.getUint32(20, true) !== 105 || !snapshot || snapshot > 1048576) {
          this.onText(BEGIN);
          this.inside = false;
          continue;
        }
        this.snapshot = snapshot;
        this.header = this.consume(24);
        this.blockHeader = this.header;
      }
      // Read payload lengths before interpreting any marker-like packet bytes.
      // 先读取载荷长度，再处理数据包中形似分隔标记的字节。
      if (this.buffer.length < CLOSE.length) return;
      if (matches(this.buffer, CLOSE)) {
        this.consume(CLOSE.length);
        this.inside = false;
        if (this.blockHeader) this.onHeader(this.blockHeader);
        this.blockRecords.forEach((record) => this.onRecord(record));
        continue;
      }
      if (this.buffer.length < 16) return;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 16);
      const length = view.getUint32(8, true);
      const original = view.getUint32(12, true);
      if (view.getUint32(0, true) > 4295 || view.getUint32(4, true) >= 1000000 || !length || length > this.snapshot || length !== original) {
        if (!this.blockHeader && !this.blockRecords.length && !this.buffer.slice(0, 16).includes(0)) {
          this.onText(BEGIN);
          this.inside = false;
          continue;
        }
        this.fail('Invalid PCAP packet record');
        continue;
      }
      if (this.buffer.length < 16 + length) return;
      this.blockRecords.push(this.consume(16 + length));
    }
  }

  finish() {
    if (this.inside) this.fail('Truncated serial capture block');
    else if (this.buffer.length) this.onText(this.buffer);
    this.buffer = new Uint8Array();
    this.inside = false;
  }
}
