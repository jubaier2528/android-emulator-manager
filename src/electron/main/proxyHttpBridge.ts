import { createConnection, createServer, type Server, type Socket } from "node:net";
import { SocksClient } from "socks";
import type { ProxyMode } from "../shared";

const maxHeaderBytes = 64 * 1024;
const connectionTimeoutMs = 15_000;

interface ProxyCredentials {
  username?: string;
  password?: string;
}

export interface ProxyBridgeOptions extends ProxyCredentials {
  mode: Exclude<ProxyMode, "none">;
  host: string;
  port: number;
}

function parseAuthority(authority: string, defaultPort?: number): { host: string; port: number } {
  const url = new URL(`http://${authority}`);
  const port = url.port ? Number(url.port) : defaultPort;
  if (!url.hostname || !port || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid proxy destination.");
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
}

function replyAndClose(socket: Socket, status: number, message: string): void {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

function connectHttpProxy(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error("Proxy connection timed out.")), connectionTimeoutMs);
    const onError = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function connectSocksProxy(options: ProxyBridgeOptions, targetHost: string, targetPort: number): Promise<Socket> {
  return SocksClient.createConnection({
    command: "connect",
    proxy: {
      host: options.host,
      port: options.port,
      type: 5,
      userId: options.username,
      password: options.password
    },
    destination: { host: targetHost, port: targetPort },
    timeout: connectionTimeoutMs
  }).then(({ socket }) => socket);
}

function connectUpstream(options: ProxyBridgeOptions, host: string, port: number): Promise<Socket> {
  return options.mode === "socks5"
    ? connectSocksProxy(options, host, port)
    : connectHttpProxy(options.host, options.port);
}

function authorizationHeader(options: ProxyBridgeOptions): string | undefined {
  if (options.username === undefined) return undefined;
  return `Proxy-Authorization: Basic ${Buffer.from(`${options.username}:${options.password ?? ""}`).toString("base64")}`;
}

function forwardSocket(client: Socket, upstream: Socket, initialData: Buffer): void {
  if (initialData.length > 0) upstream.write(initialData);
  client.pipe(upstream);
  upstream.pipe(client);
  client.once("close", () => upstream.destroy());
  upstream.once("close", () => {
    if (!client.destroyed) client.destroy();
  });
  client.once("error", () => upstream.destroy());
  upstream.once("error", () => client.destroy());
}

function handleClient(client: Socket, options: ProxyBridgeOptions): void {
  let headerBuffer = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    if (headerBuffer.length > maxHeaderBytes) {
      client.off("data", onData);
      replyAndClose(client, 431, "Request Header Fields Too Large");
      return;
    }
    const headerEnd = headerBuffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    client.off("data", onData);
    client.pause();
    const header = headerBuffer.subarray(0, headerEnd).toString("latin1");
    const initialData = headerBuffer.subarray(headerEnd + 4);
    void routeRequest(client, header, initialData, options);
  };
  client.on("data", onData);
  client.once("error", () => undefined);
}

async function tunnelThroughHttpProxy(
  client: Socket,
  upstream: Socket,
  targetHost: string,
  targetPort: number,
  initialData: Buffer,
  options: ProxyBridgeOptions
): Promise<void> {
  const host = targetHost.includes(":") ? `[${targetHost}]` : targetHost;
  const authorization = authorizationHeader(options);
  upstream.write([
    `CONNECT ${host}:${targetPort} HTTP/1.1`,
    `Host: ${host}:${targetPort}`,
    ...(authorization ? [authorization] : []),
    "Proxy-Connection: Keep-Alive",
    "",
    ""
  ].join("\r\n"));

  let response = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    response = Buffer.concat([response, chunk]);
    if (response.length > maxHeaderBytes) {
      upstream.off("data", onData);
      upstream.destroy();
      replyAndClose(client, 502, "Invalid Proxy Response");
      return;
    }
    const headerEnd = response.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    upstream.off("data", onData);
    const header = response.subarray(0, headerEnd);
    const statusLine = header.toString("latin1").split("\r\n", 1)[0];
    if (!/^HTTP\/1\.[01] 2\d\d(?:\s|$)/.test(statusLine)) {
      client.end(response);
      upstream.destroy();
      return;
    }
    const remainder = response.subarray(headerEnd + 4);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (remainder.length > 0) client.write(remainder);
    forwardSocket(client, upstream, initialData);
  };
  upstream.on("data", onData);
  upstream.once("error", () => replyAndClose(client, 502, "Proxy Connection Failed"));
}

async function routeRequest(
  client: Socket,
  header: string,
  initialData: Buffer,
  options: ProxyBridgeOptions
): Promise<void> {
  const lines = header.split("\r\n");
  const request = lines.shift()?.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/1\.[01]$/);
  if (!request) {
    replyAndClose(client, 400, "Bad Request");
    return;
  }
  const [, method, requestTarget] = request;

  try {
    if (method === "CONNECT") {
      const { host, port } = parseAuthority(requestTarget);
      if (options.mode === "http") {
        const upstream = await connectUpstream(options, host, port);
        if (client.destroyed) {
          upstream.destroy();
          return;
        }
        await tunnelThroughHttpProxy(client, upstream, host, port, initialData, options);
      } else {
        const upstream = await connectUpstream(options, host, port);
        if (client.destroyed) {
          upstream.destroy();
          return;
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        forwardSocket(client, upstream, initialData);
      }
      return;
    }

    const hostLine = lines.find((line) => /^host:/i.test(line));
    const hostHeader = hostLine?.slice(hostLine.indexOf(":") + 1).trim();
    const destination = new URL(requestTarget, hostHeader ? `http://${hostHeader}` : undefined);
    if (destination.protocol !== "http:") throw new Error("Only HTTP proxy requests are supported.");
    const port = destination.port ? Number(destination.port) : 80;
    const upstream = await connectUpstream(options, destination.hostname.replace(/^\[|\]$/g, ""), port);
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    const forwardedHeaders = lines.filter((line) =>
      !/^(?:host|proxy-authorization|proxy-connection|connection|keep-alive):/i.test(line)
    );
    if (options.mode === "http") {
      forwardedHeaders.push(`Host: ${destination.host}`);
      const authorization = authorizationHeader(options);
      if (authorization) forwardedHeaders.push(authorization);
      forwardedHeaders.push("Connection: close");
      upstream.write(`${method} ${destination.href} HTTP/1.1\r\n${forwardedHeaders.join("\r\n")}\r\n\r\n`);
    } else {
      forwardedHeaders.push(`Host: ${destination.host}`, "Connection: close");
      upstream.write(`${method} ${destination.pathname}${destination.search} HTTP/1.1\r\n${forwardedHeaders.join("\r\n")}\r\n\r\n`);
    }
    forwardSocket(client, upstream, initialData);
  } catch {
    replyAndClose(client, 502, "Bad Gateway");
  }
}

export async function createEmulatorProxyBridge(
  options: ProxyBridgeOptions
): Promise<{ port: number; close: () => void }> {
  const activeSockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    activeSockets.add(client);
    client.once("close", () => activeSockets.delete(client));
    handleClient(client, options);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the local proxy bridge.");
  }
  return {
    port: address.port,
    close: () => {
      for (const socket of activeSockets) socket.destroy();
      server.close();
    }
  };
}

export async function testEmulatorProxyConnection(options: ProxyBridgeOptions): Promise<void> {
  const bridge = await createEmulatorProxyBridge(options);
  try {
    await new Promise<void>((resolve, reject) => {
      const client = createConnection({ host: "127.0.0.1", port: bridge.port });
      let response = Buffer.alloc(0);
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("Proxy connection test timed out."));
      }, connectionTimeoutMs + 2_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        client.destroy();
        if (error) reject(error);
        else resolve();
      };
      client.once("connect", () => {
        client.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
      });
      client.on("data", (chunk) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > maxHeaderBytes) {
          finish(new Error("Proxy returned an invalid response."));
          return;
        }
        const headerEnd = response.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const statusLine = response.subarray(0, headerEnd).toString("latin1").split("\r\n", 1)[0];
        if (/^HTTP\/1\.[01] 2\d\d(?:\s|$)/.test(statusLine)) {
          finish();
        } else {
          const status = statusLine.match(/^HTTP\/1\.[01] (\d{3})/)?.[1];
          finish(new Error(status === "407"
            ? "Proxy authentication failed. Check the username and password."
            : "Proxy could not establish an HTTPS connection. Check its address, port, and settings."));
        }
      });
      client.once("error", () => {
        finish(new Error("Could not connect through the proxy. Check the address, port, and credentials."));
      });
    });
  } finally {
    bridge.close();
  }
}
