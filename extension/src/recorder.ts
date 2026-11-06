const GAME_START_TYPE = 1;
const GAME_END_TYPE = 45;

type MessagePackValue = null | boolean | number | string | Uint8Array | MessagePackValue[] | { [key: string]: MessagePackValue };

class MessagePackDecoder {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

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
const outboundEvents: MessagePackValue[] = [];
// Colonist may deliver the game snapshot BEFORE the GAME_START envelope;
// without buffering, that state (and the whole bot feed) is silently lost.
const preGameBuffer: MessagePackValue[] = [];
let activeGameId: string | null = null;
let activeServerId: string | null = null;
let activeBotColor: number | null = null;
// Outbound frames carry a per-connection sequence that must keep increasing.
// Track the client's own sequence and continue from it.
let lastOutboundSequence = 0;
// Discard frames (select + accept) run on their own counter that keeps rising
// across the game; it must not share or advance the main sequence.

// ---- Outbound capture: learn the action command schema --------------------
// Every outbound send is decoded and stored so the exact wire format of
// player actions (roll, build, end turn...) can be replayed by the bot.

const toHex = (bytes: Uint8Array, max = 64): string =>
  Array.from(bytes.slice(0, max)).map((b) => b.toString(16).padStart(2, '0')).join(' ');

const captureOutbound = async (data: unknown) => {
  try {
    let bytes: Uint8Array | null = null;
    if (data instanceof Blob) {
      bytes = new Uint8Array(await data.arrayBuffer());
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (typeof data === 'string') {
      console.log('[Renako] Outbound text frame:', data);
      return;
    }
    if (bytes) {
      // A frame may pack multiple MessagePack values (e.g. type ++ payload);
      // decoding just the first silently discards the action payload.
      const decoder = new MessagePackDecoder(bytes);
      const values: MessagePackValue[] = [];
      while (!decoder.done) {
        values.push(decoder.decode());
      }
      const frame = values.length === 1 ? values[0] : values;
      outboundEvents.push(frame);
      console.log('[Renako] Outbound frame:', JSON.stringify(frame));
      // console.log('[Renako] Outbound hex:', toHex(bytes));

      // Game-action frames end with {action, payload, sequence}; keep the
      // counter in sync so bot-sent frames continue the sequence correctly.
      if (Array.isArray(frame) && frame.length > 0) {
        const last = frame[frame.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last) && !(last instanceof Uint8Array)) {
          const sequence = (last as { sequence?: unknown }).sequence;
          const action = (last as { action?: unknown }).action;
          if (typeof sequence === 'number') {
            lastOutboundSequence = Math.max(lastOutboundSequence, sequence);
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Renako] Unable to decode outbound frame', error);
  }
};

// ---- MessagePack encoder for bot commands ---------------------------------

const encodeMessagePack = (value: MessagePackValue): Uint8Array<ArrayBuffer> => {
  if (value === null) return Uint8Array.of(0xc0);
  if (value === false) return Uint8Array.of(0xc2);
  if (value === true) return Uint8Array.of(0xc3);
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
      return Uint8Array.of(value);
    }
    const bytes = new Uint8Array(5);
    new DataView(bytes.buffer).setUint8(0, 0xce);
    new DataView(bytes.buffer).setUint32(1, value >>> 0);
    return bytes;
  }
  if (typeof value === 'string') {
    const utf8 = new TextEncoder().encode(value);
    const head = utf8.length <= 31
      ? Uint8Array.of(0xa0 | utf8.length)
      : Uint8Array.of(0xd9, utf8.length);
    return concatBytes(head, utf8);
  }
  if (value instanceof Uint8Array) {
    return concatBytes(Uint8Array.of(0xc4, value.length), value);
  }
  if (Array.isArray(value)) {
    const head = value.length <= 15
      ? Uint8Array.of(0x90 | value.length)
      : Uint8Array.of(0xdc, value.length >> 8, value.length & 0xff);
    return concatBytes(head, ...value.map(encodeMessagePack));
  }
  const entries = Object.entries(value);
  const head = entries.length <= 15
    ? Uint8Array.of(0x80 | entries.length)
    : Uint8Array.of(0xde, entries.length >> 8, entries.length & 0xff);
  return concatBytes(
    head,
    ...entries.flatMap(([k, v]) => [encodeMessagePack(k), encodeMessagePack(v)]),
  );
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// ---- Decision -> wire action ----------------------------------------------
// The exact Colonist command envelopes are learned from captured outbound
// frames (see captureOutbound). Fill in the mapping after one manual game.

let activeSocket: WebSocket | null = null;

// Canonical action -> Colonist game-action code. Filled from captured
// outbound frames; a code of null means "not yet captured, log and skip".
// Action guess:
// select bank trade: 47
// steal: [Renako] Outbound frame: [3,1,6,48,49,56,70,48,55,{"action":5,"payload":3,"sequence":28}] - payload is the target player ID
//[Renako] Outbound frame: [3,1,6,48,55,66,70,50,65,{"action":49,"payload":{"creator":1,"isBankTrade":true,"counterOfferInResponseToTradeId":null,"offeredResources":[1,1,1,1],"wantedResources":[5]},"sequence":40}]
const GAME_ACTION_CODES: Record<string, number | null> = {
  ROLL: 2,
  END_TURN: 6,
  SELECT_ROAD: 10,
  BUILD_ROAD: 11,
  SELECT_SETTLEMENT: 14,
  BUILD_SETTLEMENT: 15,
  SELECT_CITY: 17,
  BUILD_CITY: 18,
  MOVE_ROBBER: 3,
  STEAL_FROM: 5,
  // SELECT_DISCARD: 8,
  DISCARD_RESOURCE: 7, 
  BUY_DEVELOPMENT_CARD: 9,
  MARITIME_TRADE: 49,
  // Respond to another player's offer: payload {id, response}; 1 = accept, 0 = decline.
  TRADE_RESPONSE: 50,
};

// Parameterless protocol actions carry a fixed payload instead of a location:
// captured frames show {"action":2,"payload":true} for ROLL. Sending null is
// rejected by the server.
const ACTION_PAYLOAD_OVERRIDES: Record<string, MessagePackValue> = {
  ROLL: true,
  END_TURN: true,
};

const RESOURCE_NAME_TO_CARD_ID: Record<string, number> = {
  WOOD: 1,
  BRICK: 2,
  SHEEP: 3,
  WHEAT: 4,
  ORE: 5,
};

const toResourceId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.toUpperCase();
    return RESOURCE_NAME_TO_CARD_ID[normalized] ?? null;
  }
  return null;
};

const maritimeTradePayloadFromAction = (action: { type: string; parameter: unknown }): MessagePackValue | null => {
  if (!Array.isArray(action.parameter) || action.parameter.length !== 5) {
    console.warn('[Renako] Invalid MARITIME_TRADE parameter:', action.parameter);
    return null;
  }
  if (activeBotColor == null) {
    console.warn('[Renako] Missing bot color for MARITIME_TRADE payload');
    return null;
  }

  const offeredResources: number[] = [];
  for (const value of action.parameter.slice(0, 4)) {
    if (value == null) continue;
    const resourceId = toResourceId(value);
    if (resourceId == null) {
      console.warn('[Renako] Invalid offered MARITIME_TRADE resource:', value);
      return null;
    }
    offeredResources.push(resourceId);
  }

  const wanted = toResourceId(action.parameter[4]);
  if (wanted == null) {
    console.warn('[Renako] Invalid wanted MARITIME_TRADE resource:', action.parameter[4]);
    return null;
  }
  if (offeredResources.length === 0) {
    console.warn('[Renako] Empty offered MARITIME_TRADE resources');
    return null;
  }

  return {
    creator: activeBotColor,
    isBankTrade: true,
    counterOfferInResponseToTradeId: null,
    offeredResources,
    wantedResources: [wanted],
  };
};

// Game-action frame: [channel 3, subtype 1, idLen, idBytes, msgpack payload].
// The id is the serverId announced in the inbound GAME_START envelope, and
// the namespace bytes are raw (length-prefixed, not msgpack strings).
const encodeGameActionFrame = (
  serverId: string,
  actionCode: number,
  payload: MessagePackValue,
  sequence: number,
): Uint8Array<ArrayBuffer> => {
  const idBytes = new TextEncoder().encode(serverId);
  return concatBytes(
    Uint8Array.of(3, 1, idBytes.length),
    idBytes,
    encodeMessagePack({ action: actionCode, payload, sequence }),
  );
};

const sendGameFrame = (code: number, payload: MessagePackValue) => {
  let sequence: number;
  lastOutboundSequence += 1;
  sequence = lastOutboundSequence;
  const frame = encodeGameActionFrame(activeServerId!, code, payload, sequence);
  activeSocket!.send(frame);
  console.log('[Renako] Sent frame: action', code, 'seq', sequence);
  console.log('[Renako] Sent bot action hex:', toHex(frame));
};

const BOT_SENDS_ACTIONS = true;

const sendBotAction = (action: { type: string; parameter: unknown; victim?: number | null }, kind?: string) => {
  console.log('[Renako] Bot action decision:', JSON.stringify(action));
  if (!BOT_SENDS_ACTIONS) return;
  if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
    console.warn('[Renako] No open socket for bot action', action);
    return;
  }
  if (!activeServerId) {
    console.warn('[Renako] No serverId captured yet; cannot send', action);
    return;
  }
  const code = GAME_ACTION_CODES[action.type];
  if (code == null) {
    console.warn('[Renako] No outbound action code captured yet for', action.type);
    return;
  }
  let payload: MessagePackValue;
  if (action.type in ACTION_PAYLOAD_OVERRIDES) {
    payload = ACTION_PAYLOAD_OVERRIDES[action.type];
  } else if (action.type === 'MARITIME_TRADE') {
    const tradePayload = maritimeTradePayloadFromAction(action);
    if (tradePayload == null) return;
    payload = tradePayload;
  } else if (action.type === 'DISCARD_RESOURCE') {

    const discard = action.parameter;

    if (!Array.isArray(discard) || discard.length === 0) {
      console.warn('[Renako] Invalid DISCARD_RESOURCE parameter:', action.parameter);
      return;
    }

     sendGameFrame(
          code,
          discard as MessagePackValue
        );

    return;
  } else {
    payload = (action.parameter ?? null) as MessagePackValue;
  }
  const SELECT_CODE_FOR_BUILD: Record<string, string> = {
    BUILD_ROAD: 'SELECT_ROAD',
    BUILD_SETTLEMENT: 'SELECT_SETTLEMENT',
    BUILD_CITY: 'SELECT_CITY',
  };
  const selectCode = GAME_ACTION_CODES[SELECT_CODE_FOR_BUILD[action.type]];
  if (kind === 'main' && selectCode != null) {
    sendGameFrame(selectCode, true);
    setTimeout(() => sendGameFrame(code, payload), 300);
  } else {
    sendGameFrame(code, payload);
  }
  if (action.type === 'MOVE_ROBBER' && action.victim != null) {
    setTimeout(() => sendGameFrame(GAME_ACTION_CODES.STEAL_FROM!, action.victim!), 500);
  }
};

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

const respondedTradeIds = new Set<string>();

// Finds open offers from other players inside a state diff. The offer's id is
// read from its own `id` field, falling back to the map key that holds it.
// The gameLogState copy of an offer (type 118) carries no id, so it is skipped.
const findIncomingTradeOffers = (diff: unknown): string[] => {
  const ids: string[] = [];
  const walk = (value: unknown, key: string | null) => {
    if (!value || typeof value !== 'object' || value instanceof Uint8Array) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, null));
      return;
    }
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.offeredResources) || Array.isArray(node.offeredCardEnums)) {
      const creator = node.creator ?? node.playerColor;
      const id = typeof node.id === 'string' ? node.id : (key && !/^\d+$/.test(key) ? key : null);
      if (id && node.isBankTrade !== true && creator !== activeBotColor) ids.push(id);
      return;
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey === 'gameLogState') continue;
      walk(child, childKey);
    }
  };
  walk(diff, null);
  return ids;
};

// response : 1 (decline)
// response : 0 (accept)
const autoDeclineTrades = (diff: unknown) => {
  if (activeBotColor == null) return;
  for (const id of findIncomingTradeOffers(diff)) {
    if (respondedTradeIds.has(id)) continue;
    respondedTradeIds.add(id);
    console.log('[Renako] Auto-declining trade offer', id);
    sendBotAction({ type: 'TRADE_RESPONSE', parameter: { id, response: 1 } });
  }
};

const recordMessage = async (event: MessageEvent) => {
  try {
    const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    if (!(buffer instanceof ArrayBuffer)) return;

    const message = new MessagePackDecoder(new Uint8Array(buffer)).decode();
    const eventType = getEventType(message);

    // Gameplay actions echo back inside type-91 diffs; logging them next to
    // outbound frames makes the outbound action-code mapping self-evident.
    if (eventType === 91) {
      const diff = (message as any)?.data?.payload?.diff;
      const logState = diff?.gameLogState;
      if (logState && typeof logState === 'object') {
        for (const entry of Object.values(logState)) {
          const text = (entry as any)?.text;
          if (text && typeof text === 'object') {
            console.log('[Renako] Inbound action:', JSON.stringify(text));
            if ((text as any).type === 118) {
              // Logged so the offer id location can be verified in a real game.
              console.log('[Renako] Trade offer diff:', JSON.stringify(diff));
            }
          }
        }
      }
      autoDeclineTrades(diff);
    }

    const shouldForward = [
      1, 4, 28, 30, 31, 33, 43, 45, 91
    ].includes(eventType ?? -1);

    if (eventType === GAME_START_TYPE && !activeGameId) {
      const gameId = getGameId(message);
      if (gameId) {
        activeGameId = gameId;
        const startPayload = (message as { data?: { payload?: { serverId?: unknown } } })?.data?.payload;
        if (typeof startPayload?.serverId === 'string') {
          activeServerId = startPayload.serverId;
        }
        // Flush anything that arrived before GAME_START (e.g. the snapshot)
        // so both the recording and the bot session get the full state.
        recordedEvents.push(...preGameBuffer, message);
        if (preGameBuffer.length) {
          console.log(`[Renako] Flushing ${preGameBuffer.length} pre-start messages (snapshot included if present)`);
          for (const buffered of preGameBuffer) {
            await sendBotEvent(gameId, null, buffered);
          }
          preGameBuffer.length = 0;
        }
        await sendBotEvent(gameId, null, message);
        return;
      }
    }

    if (!activeGameId) {
      // Not in a game yet: keep a small buffer in case the snapshot precedes start.
      preGameBuffer.push(message);
      if (preGameBuffer.length > 100) preGameBuffer.shift();
      return;
    }

    if (shouldForward) {
      const data = message as any;
      const botColor =
        data?.data?.payload?.playerColor ??
        data?.data?.payload?.gameState?.currentState?.currentTurnPlayerColor ??
        null;

      await sendBotEvent(activeGameId, botColor, message);
    }

    recordedEvents.push(message);
    if (eventType === GAME_END_TYPE) {
      const completedGameId = activeGameId;
      window.dispatchEvent(new CustomEvent('renako-game-complete', {
        detail: JSON.stringify({ gameId: completedGameId, events: recordedEvents })
      }));
      downloadGameLog(completedGameId, recordedEvents);
      activeGameId = null;
      activeBotColor = null;
      respondedTradeIds.clear();
      recordedEvents.length = 0;
    }
  } catch (error) {
    console.error('[Renako] Bot pipeline error (message not forwarded):', error);
  }
};

const sendBotEvent = async (
  gameId: string,
  botColor: number | null,
  message: MessagePackValue
) => {
  if (typeof botColor === 'number') {
    activeBotColor = botColor;
  }
  const response = await fetch('http://localhost:8000/api/bot/games/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      game_id: gameId,
      bot_color: botColor,
      event: message
    })
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Bot API ${response.status}: ${responseText}`);
  }
  console.log('[Renako] Bot API response:', responseText);

  const result = JSON.parse(responseText);
  if (result.status === 'ACTION' && result.action) {
    // The decision arrives the moment the state diff lands, but the server's
    // action window opens slightly later. Delay to avoid rejected frames.
    // const delay = 800 + Math.random() * 700;
    const delay = 1000
    setTimeout(() => sendBotAction(result.action, result.decision_kind), delay);
  }
};

const OriginalWebSocket = window.WebSocket;
const OriginalSend = OriginalWebSocket.prototype.send;
OriginalWebSocket.prototype.send = function (data: any) {
  console.log('[Renako] send() called:', data?.constructor?.name ?? typeof data);
  captureOutbound(data);
  return OriginalSend.call(this, data);
};
const attachRecorder = (socket: WebSocket) => {
  activeSocket = socket;
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
