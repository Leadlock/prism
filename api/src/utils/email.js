import net from "net";
import tls from "tls";

const CRLF = "\r\n";

function encodeBase64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        const code = parseInt(last.slice(0, 3), 10);
        if (code >= 400) reject(new Error(last));
        else resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function writeCommand(socket, line) {
  socket.write(`${line}${CRLF}`);
  return readResponse(socket);
}

// Upgrade a plain socket to TLS in-place (STARTTLS).
function upgradeToTLS(plainSocket, host) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket: plainSocket,
      servername: host,
    });
    tlsSocket.once("secureConnect", () => resolve(tlsSocket));
    tlsSocket.once("error", reject);
  });
}

function createSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect(port, host, { servername: host }, () => resolve(socket))
      : net.connect(port, host, () => resolve(socket));
    socket.once("error", reject);
  });
}

export async function sendEmail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || "noreply@auditready.local";

  if (!host) {
    console.log(`[email disabled] To: ${to}; Subject: ${subject}; ${text}`);
    return { skipped: true };
  }

  const port = Number(process.env.SMTP_PORT || 465);
  // STARTTLS mode: connect plain then upgrade (used by Gmail port 587, Outlook 587, etc.)
  const starttls = String(process.env.SMTP_STARTTLS || "false").toLowerCase() === "true";
  const secure = !starttls && String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  let socket = await createSocket({ host, port, secure });

  try {
    await readResponse(socket);
    await writeCommand(socket, `EHLO ${process.env.SMTP_HELO || "auditready.local"}`);

    if (starttls) {
      await writeCommand(socket, "STARTTLS");
      socket = await upgradeToTLS(socket, host);
      // Re-EHLO after TLS upgrade as required by RFC 3207
      await writeCommand(socket, `EHLO ${process.env.SMTP_HELO || "auditready.local"}`);
    }

    if (user && pass) {
      await writeCommand(socket, "AUTH LOGIN");
      await writeCommand(socket, encodeBase64(user));
      await writeCommand(socket, encodeBase64(pass));
    }

    await writeCommand(socket, `MAIL FROM:<${from}>`);
    await writeCommand(socket, `RCPT TO:<${to}>`);
    await writeCommand(socket, "DATA");
    socket.write([
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
      "."
    ].join(CRLF) + CRLF);
    await readResponse(socket);
    await writeCommand(socket, "QUIT").catch(() => null);
    return { sent: true };
  } finally {
    socket.end();
  }
}
