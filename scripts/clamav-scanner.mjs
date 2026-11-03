import { createConnection } from "node:net";
import { once } from "node:events";

function writeToSocket(socket, data) {
  if (socket.write(data)) return Promise.resolve();
  return once(socket, "drain");
}

export async function scanStream(
  body,
  { host, port, expectedBytes, maxBytes, timeoutMs = 900_000 },
) {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maxBytes) {
    throw new Error("FILE_SIZE_OUTSIDE_SCAN_LIMIT");
  }

  const socket = createConnection({ host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error("CLAMAV_SCAN_TIMEOUT")));

  let reply = Buffer.alloc(0);
  let resolveReply;
  let rejectReply;
  let hasReply = false;
  const replyPromise = new Promise((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  });
  void replyPromise.catch(() => undefined);

  socket.on("data", (chunk) => {
    reply = Buffer.concat([reply, chunk]);
    const end = reply.indexOf(0);
    if (end >= 0 && !hasReply) {
      hasReply = true;
      resolveReply(reply.subarray(0, end).toString("utf8"));
    }
  });
  socket.on("error", (error) => {
    if (!hasReply) rejectReply(error);
  });
  socket.on("close", () => {
    if (!hasReply) rejectReply(new Error("CLAMAV_CLOSED_WITHOUT_RESULT"));
  });

  try {
    const connected = new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    await connected;
    await writeToSocket(socket, Buffer.from("zINSTREAM\0", "ascii"));

    let streamedBytes = 0;
    for await (const rawChunk of body) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      streamedBytes += chunk.length;
      if (streamedBytes > expectedBytes || streamedBytes > maxBytes || chunk.length > 0xffffffff) {
        throw new Error("FILE_STREAM_SIZE_MISMATCH");
      }
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      await writeToSocket(socket, length);
      await writeToSocket(socket, chunk);
    }
    if (streamedBytes !== expectedBytes) throw new Error("FILE_STREAM_SIZE_MISMATCH");

    await writeToSocket(socket, Buffer.alloc(4));
    const result = (await replyPromise).trim();
    if (result === "stream: OK") return { clean: true, result };
    if (result.startsWith("stream: ") && result.endsWith(" FOUND")) return { clean: false, result };
    throw new Error("CLAMAV_INDETERMINATE_RESULT");
  } finally {
    socket.destroy();
  }
}
