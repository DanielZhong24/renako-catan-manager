const GAME_START_TYPE = 1;
const GAME_END_TYPE = 45;

type MessagePackValue = null | boolean | number | string | Uint8Array | MessagePackValue[] | { [key: string]: MessagePackValue };

class MessagePackDecoder {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  decode(): MessagePackValue {
    return this.readValue();
  }

  private readValue(): MessagePackValue {
    const prefix = this.readUint8();

    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0xe0) return prefix - 0x100;
    if (prefix >= 0xa0 && prefix <= 0xbf) return this.readString(prefix - 0xa0);
    if (prefix >= 0x90 && prefix <= 0x9f) return this.readArray(prefix - 0x90);
    if (prefix >= 0x80 && prefix <= 0x8f) return this.readMap(prefix - 0x80);

    switch (prefix) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: return this.readFloat32();
      case 0xcb: return this.readFloat64();
      case 0xcc: return this.readUint8();
      case 0xcd: return this.readUint16();
      case 0xce: return this.readUint32();
      case 0xcf: return this.readUint64();
      case 0xd0: return this.readInt8();
      case 0xd1: return this.readInt16();
      case 0xd2: return this.readInt32();
      case 0xd3: return this.readInt64();
      case 0xd9: return this.readString(this.readUint8());
      case 0xda: return this.readString(this.readUint16());
      case 0xdb: return this.readString(this.readUint32());
      case 0xc4: return this.readBytes(this.readUint8());
      case 0xc5: return this.readBytes(this.readUint16());
      case 0xc6: return this.readBytes(this.readUint32());
      case 0xdc: return this.readArray(this.readUint16());
      case 0xdd: return this.readArray(this.readUint32());
      case 0xde: return this.readMap(this.readUint16());
      case 0xdf: return this.readMap(this.readUint32());
      default: throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}`);
    }
  }

  private readArray(length: number): MessagePackValue[] {
    return Array.from({ length }, () => this.readValue());
  }

  private readMap(length: number): { [key: string]: MessagePackValue } {
    const result: { [key: string]: MessagePackValue } = {};
    for (let index = 0; index < length; index += 1) {
      const key = this.readValue();
      result[String(key)] = this.readValue();
    }
    return result;
  }

  private readString(length: number): string {
    return new TextDecoder().decode(this.readBytes(length));
  }

  private readBytes(length: number): Uint8Array {
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private readUint8(): number {
    return this.bytes[this.offset++];
  }

  private readUint16(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 2).getUint16(0);
    this.offset += 2;
    return value;
  }

  private readUint32(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getUint32(0);
    this.offset += 4;
    return value;
  }

  private readUint64(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getBigUint64(0);
    this.offset += 8;
    return Number(value);
  }

  private readInt8(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 1).getInt8(0);
    this.offset += 1;
    return value;
  }

  private readInt16(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 2).getInt16(0);
    this.offset += 2;
    return value;
  }

  private readInt32(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getInt32(0);
    this.offset += 4;
    return value;
  }

  private readInt64(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getBigInt64(0);
    this.offset += 8;
    return Number(value);
  }

  private readFloat32(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getFloat32(0);
    this.offset += 4;
    return value;
  }

  private readFloat64(): number {
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getFloat64(0);
    this.offset += 8;
    return value;
  }
}

const recordedEvents: MessagePackValue[] = [];
let activeGameId: string | null = null;

const getEventType = (message: MessagePackValue): number | null => {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message instanceof Uint8Array) return null;
  const data = message.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data instanceof Uint8Array) return null;
  return typeof data.type === 'number' ? data.type : null;
};

const getGameId = (message: MessagePackValue): string | null => {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message instanceof Uint8Array) return null;
  const data = message.data;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data instanceof Uint8Array) return null;
  const payload = data.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload instanceof Uint8Array) return null;
  return typeof payload.databaseGameId === 'string' ? payload.databaseGameId : null;
};

const downloadGameLog = (gameId: string, events: MessagePackValue[]) => {
  const blob = new Blob([JSON.stringify(events)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `renako-${gameId}.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
};

const recordMessage = async (event: MessageEvent) => {
  try {
    const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    if (!(buffer instanceof ArrayBuffer)) return;

    const message = new MessagePackDecoder(new Uint8Array(buffer)).decode();
    const eventType = getEventType(message);

    if (activeGameId) {
      recordedEvents.push(message);
      if (eventType === GAME_END_TYPE) {
        const completedGameId = activeGameId;
        window.dispatchEvent(new CustomEvent('renako-game-complete', {
          detail: JSON.stringify({ gameId: completedGameId, events: recordedEvents })
        }));
        downloadGameLog(completedGameId, recordedEvents);
        activeGameId = null;
        recordedEvents.length = 0;
      }
    } else if (eventType === GAME_START_TYPE) {
      const gameId = getGameId(message);
      if (gameId) {
        activeGameId = gameId;
        recordedEvents.push(message);
      }
    }
  } catch (error) {
    console.debug('[Renako] Unable to decode Colonist WebSocket message', error);
  }
};

const OriginalWebSocket = window.WebSocket;
const attachRecorder = (socket: WebSocket) => {
  socket.addEventListener('message', recordMessage);
  return socket;
};

window.WebSocket = new Proxy(OriginalWebSocket, {
  apply(target, thisArg, argumentsList) {
    return attachRecorder(Reflect.apply(target, thisArg, argumentsList));
  },
  construct(target, argumentsList, newTarget) {
    return attachRecorder(Reflect.construct(target, argumentsList, newTarget));
  }
});
