/**
 * A minimal RFC 6455 WebSocket implementation, both sides, written here so this experiment needs no dependency at all.
 *
 * Why hand-rolled: the experiment's whole point is to be isolated and reversible. Adding a package to the repository
 * lockfile for a throwaway harness is not. The browser side needs nothing (WebSocket is built in), and the Node side
 * needs a client too — `connect()` below — because the proxy must be able to send an `Authorization: Bearer` header,
 * which the WHATWG WebSocket in Node does not offer. Writing both sides here keeps the key server-side and the
 * dependency count at zero.
 *
 * Scope: text and binary messages, continuation frames, ping/pong, close. No extensions, no permessage-deflate, no
 * subprotocols. Client frames are masked and server frames are not, as the RFC requires. Payloads over `maxPayload`
 * close with 1009 rather than buffering without limit.
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 4 * 1024 * 1024;
const accepted = (key) => createHash("sha1").update(key + GUID).digest("base64");

/** Completes the opening handshake on an already-upgraded socket and returns a Conn (server side: unmasked frames). */
export function accept(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) return null;
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accepted(key)}\r\n\r\n`,
  );
  return new Conn(socket);
}

/** Opens a WebSocket to `url` (ws: or wss:) with optional extra headers. Resolves once the handshake is verified. */
export function connect(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "wss:";
  const lib = secure ? https : http;
  const key = randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    const request = lib.request({
      // node:http needs its own scheme; ws:/wss: are translated by picking the http/https module above.
      protocol: secure ? "https:" : "http:",
      hostname: parsed.hostname,
      port: parsed.port || (secure ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: {
        Host: parsed.host,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        ...headers,
      },
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error("upstream did not answer the handshake in time"));
    }, timeoutMs);
    request.on("upgrade", (response, socket) => {
      clearTimeout(timer);
      if ((response.headers["sec-websocket-accept"] ?? "") !== accepted(key)) {
        socket.destroy();
        reject(new Error("upstream answered with an invalid Sec-WebSocket-Accept"));
        return;
      }
      resolve(new Conn(socket, { mask: true }));
    });
    request.on("response", (response) => {
      clearTimeout(timer);
      request.destroy();
      reject(new Error(`upstream refused the upgrade: HTTP ${response.statusCode}`));
    });
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

export class Conn {
  #socket;
  #mask;
  #buffer = Buffer.alloc(0);
  #fragments = [];
  #fragmentOpcode = 0;
  #closed = false;
  #handlers = { message: [], close: [] };

  constructor(socket, { mask = false } = {}) {
    this.#socket = socket;
    this.#mask = mask;
    socket.on("data", (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      try {
        this.#drain();
      } catch {
        this.close(1002); // protocol error
      }
    });
    socket.on("close", () => this.#finish());
    socket.on("error", () => this.#finish());
    socket.on("end", () => this.#finish());
  }

  on(event, handler) {
    this.#handlers[event]?.push(handler);
    return this;
  }

  get closed() {
    return this.#closed;
  }

  /** Sends a text message (string) or a binary message (Buffer/Uint8Array). */
  send(data) {
    if (this.#closed) return;
    const text = typeof data === "string";
    this.#write(text ? 0x1 : 0x2, text ? Buffer.from(data, "utf8") : Buffer.from(data));
  }

  /** Sends a JSON message if the value is an object, a text message if it is already a string. */
  sendJson(value) {
    this.send(typeof value === "string" ? value : JSON.stringify(value));
  }

  close(code = 1000) {
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    try {
      if (!this.#closed) this.#write(0x8, payload);
    } catch {
      /* the socket is already gone */
    }
    this.#finish();
  }

  #write(opcode, payload) {
    const length = payload.length;
    const masked = this.#mask;
    let header;
    if (length < 126) {
      header = Buffer.alloc(masked ? 6 : 2);
      header[1] = (masked ? 0x80 : 0) | length;
    } else if (length < 65536) {
      header = Buffer.alloc(masked ? 8 : 4);
      header[1] = (masked ? 0x80 : 0) | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(masked ? 14 : 10);
      header[1] = (masked ? 0x80 : 0) | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode; // FIN, no RSV bits
    let maskKey = null;
    if (masked) {
      maskKey = randomBytes(4);
      maskKey.copy(header, header.length - 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
    }
    this.#socket.write(Buffer.concat([header, payload]));
  }

  #drain() {
    for (;;) {
      if (this.#buffer.length < 2) return;
      const b0 = this.#buffer[0];
      const b1 = this.#buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let length = b1 & 0x7f;
      let at = 2;
      if (length === 126) {
        if (this.#buffer.length < 4) return;
        length = this.#buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (this.#buffer.length < 10) return;
        const big = this.#buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) {
          this.close(1009);
          return;
        }
        length = Number(big);
        at = 10;
      }
      if (length > MAX_PAYLOAD) {
        this.close(1009);
        return;
      }
      let mask = null;
      if (masked) {
        if (this.#buffer.length < at + 4) return;
        mask = this.#buffer.subarray(at, at + 4);
        at += 4;
      }
      if (this.#buffer.length < at + length) return;
      const payload = Buffer.from(this.#buffer.subarray(at, at + length));
      this.#buffer = this.#buffer.subarray(at + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];

      if (opcode === 0x8) {
        this.close(1000);
        return;
      }
      if (opcode === 0x9) {
        this.#write(0xa, payload); // pong
        continue;
      }
      if (opcode === 0xa) continue; // a pong: nothing to do

      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) this.#deliver(opcode, payload);
        else {
          this.#fragmentOpcode = opcode;
          this.#fragments = [payload];
        }
        continue;
      }
      if (opcode === 0x0) {
        this.#fragments.push(payload);
        if (fin) {
          const joined = Buffer.concat(this.#fragments);
          this.#fragments = [];
          this.#deliver(this.#fragmentOpcode, joined);
        }
      }
    }
  }

  #deliver(opcode, payload) {
    const text = opcode === 0x1;
    const data = text ? payload.toString("utf8") : payload;
    for (const handler of this.#handlers.message) handler(data, !text);
  }

  #finish() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#socket.destroy();
    } catch {
      /* already gone */
    }
    for (const handler of this.#handlers.close) handler();
  }
}

/** Wires a plain node:http server so requests whose path matches one of `paths` upgrade to a WebSocket. */
export function attach(server, paths, onConnection) {
  server.on("upgrade", (req, socket) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!paths.includes(path)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const conn = accept(req, socket);
    if (conn) onConnection(conn, req, path);
  });
}
