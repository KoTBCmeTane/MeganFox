const http = require('http');
const { WebSocketServer } = require('ws');
const { z } = require('zod');

const PORT = Number(process.env.PORT || 8080);

const ClientHello = z.object({
  type: z.literal('hello'),
  userId: z.string().min(1),
  displayName: z.string().min(1).max(64),
});

const Join = z.object({
  type: z.literal('join'),
  chatId: z.string().min(1),
});

const ChatMessage = z.object({
  type: z.literal('chat:message'),
  chatId: z.string().min(1),
  clientMsgId: z.string().min(1),
  text: z.string().max(4000).optional(),
  audioBase64: z.string().optional(),
  audioMime: z.string().optional(),
  // video circle later
});

const Signal = z.object({
  type: z.literal('signal'),
  toUserId: z.string().min(1),
  payload: z.any(), // { kind: 'offer'|'answer'|'ice', ... }
});

const FriendsRequest = z.object({
  type: z.literal('friends:request'),
  toUserId: z.string().min(1),
});

const FriendsAccept = z.object({
  type: z.literal('friends:accept'),
  fromUserId: z.string().min(1),
});

const FriendsList = z.object({
  type: z.literal('friends:list'),
});

const CallInvite = z.object({
  type: z.literal('call:invite'),
  toUserId: z.string().min(1),
  callId: z.string().min(1),
});

const CallAccept = z.object({
  type: z.literal('call:accept'),
  toUserId: z.string().min(1),
  callId: z.string().min(1),
});

const CallReject = z.object({
  type: z.literal('call:reject'),
  toUserId: z.string().min(1),
  callId: z.string().min(1),
});

const CallHangup = z.object({
  type: z.literal('call:hangup'),
  toUserId: z.string().min(1),
  callId: z.string().min(1),
});

const Inbound = z.discriminatedUnion('type', [
  ClientHello,
  Join,
  ChatMessage,
  Signal,
  FriendsRequest,
  FriendsAccept,
  FriendsList,
  CallInvite,
  CallAccept,
  CallReject,
  CallHangup,
]);

/** @type {Map<string, any>} */
const clientsById = new Map(); // userId -> { ws, userId, displayName, chats:Set<string>, friends:Set<string>, incoming:Set<string>, outgoing:Set<string> }

/** @type {Map<string, { userId:string, displayName:string }>} */
const usersDirectory = new Map(); // userId -> { userId, displayName }

/** @type {Map<string, Set<string>>} */
const chatMembers = new Map(); // chatId -> Set<userId>

function nowMs() {
  return Date.now();
}

function safeSend(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

function broadcastToChat(chatId, obj) {
  const members = chatMembers.get(chatId);
  if (!members) return;
  for (const userId of members) {
    const c = clientsById.get(userId);
    if (c?.ws?.readyState === 1) safeSend(c.ws, obj);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // eslint-disable-next-line no-console
  console.log('ws connection opened');
  /** @type {null | { ws:any, userId:string, displayName:string, chats:Set<string>, friends:Set<string>, incoming:Set<string>, outgoing:Set<string> }} */
  let client = null;

  safeSend(ws, { type: 'server:hello', ts: nowMs() });

  ws.on('message', (data) => {
    let parsed;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      safeSend(ws, { type: 'error', message: 'bad_json' });
      return;
    }

    const v = Inbound.safeParse(parsed);
    if (!v.success) {
      safeSend(ws, { type: 'error', message: 'bad_message', details: v.error.issues });
      return;
    }

    const msg = v.data;

    if (msg.type === 'hello') {
      // one active connection per userId
      const existing = clientsById.get(msg.userId);
      if (existing?.ws && existing.ws.readyState === 1) {
        safeSend(existing.ws, { type: 'server:kick', reason: 'new_session' });
        try { existing.ws.close(); } catch {}
      }

      const prev = clientsById.get(msg.userId);
      client = {
        ws,
        userId: msg.userId,
        displayName: msg.displayName,
        chats: new Set(),
        friends: prev?.friends ?? new Set(),
        incoming: prev?.incoming ?? new Set(),
        outgoing: prev?.outgoing ?? new Set(),
      };
      clientsById.set(msg.userId, client);
      usersDirectory.set(msg.userId, { userId: msg.userId, displayName: msg.displayName });
      safeSend(ws, { type: 'hello:ack', userId: msg.userId, ts: nowMs() });
      return;
    }

    if (!client) {
      safeSend(ws, { type: 'error', message: 'not_hello' });
      return;
    }

    if (msg.type === 'join') {
      client.chats.add(msg.chatId);
      if (!chatMembers.has(msg.chatId)) chatMembers.set(msg.chatId, new Set());
      chatMembers.get(msg.chatId).add(client.userId);

      safeSend(ws, { type: 'chat:joined', chatId: msg.chatId, ts: nowMs() });
      broadcastToChat(msg.chatId, {
        type: 'chat:presence',
        chatId: msg.chatId,
        userId: client.userId,
        displayName: client.displayName,
        status: 'online',
        ts: nowMs(),
      });
      return;
    }

    if (msg.type === 'chat:message') {
      // basic fanout (no persistence)
      broadcastToChat(msg.chatId, {
        type: 'chat:message',
        chatId: msg.chatId,
        fromUserId: client.userId,
        displayName: client.displayName,
        clientMsgId: msg.clientMsgId,
        text: msg.text ?? '',
        audioBase64: msg.audioBase64 ?? null,
        audioMime: msg.audioMime ?? null,
        ts: nowMs(),
      });
      return;
    }

    if (msg.type === 'signal') {
      const to = clientsById.get(msg.toUserId);
      if (!to?.ws || to.ws.readyState !== 1) {
        safeSend(ws, { type: 'signal:error', toUserId: msg.toUserId, message: 'offline' });
        return;
      }
      safeSend(to.ws, { type: 'signal', fromUserId: client.userId, payload: msg.payload, ts: nowMs() });
      return;
    }

    if (msg.type === 'call:invite') {
      const to = clientsById.get(msg.toUserId);
      if (!to?.ws || to.ws.readyState !== 1) {
        safeSend(ws, { type: 'call:invite:error', toUserId: msg.toUserId, callId: msg.callId, message: 'offline' });
        return;
      }
      safeSend(to.ws, {
        type: 'call:invite',
        fromUserId: client.userId,
        fromDisplayName: client.displayName,
        callId: msg.callId,
        ts: nowMs(),
      });
      safeSend(ws, { type: 'call:invite:ok', toUserId: msg.toUserId, callId: msg.callId, ts: nowMs() });
      return;
    }

    if (msg.type === 'call:accept') {
      const to = clientsById.get(msg.toUserId);
      if (!to?.ws || to.ws.readyState !== 1) return;
      safeSend(to.ws, {
        type: 'call:accept',
        fromUserId: client.userId,
        fromDisplayName: client.displayName,
        callId: msg.callId,
        ts: nowMs(),
      });
      return;
    }

    if (msg.type === 'call:reject') {
      const to = clientsById.get(msg.toUserId);
      if (!to?.ws || to.ws.readyState !== 1) return;
      safeSend(to.ws, {
        type: 'call:reject',
        fromUserId: client.userId,
        fromDisplayName: client.displayName,
        callId: msg.callId,
        ts: nowMs(),
      });
      return;
    }

    if (msg.type === 'call:hangup') {
      const to = clientsById.get(msg.toUserId);
      if (!to?.ws || to.ws.readyState !== 1) return;
      safeSend(to.ws, {
        type: 'call:hangup',
        fromUserId: client.userId,
        fromDisplayName: client.displayName,
        callId: msg.callId,
        ts: nowMs(),
      });
      return;
    }

    if (msg.type === 'friends:list') {
      const friends = Array.from(client.friends).map((userId) => {
        const u = usersDirectory.get(userId);
        const online = Boolean(clientsById.get(userId)?.ws?.readyState === 1);
        return { userId, displayName: u?.displayName ?? userId, online };
      });
      const incoming = Array.from(client.incoming).map((userId) => {
        const u = usersDirectory.get(userId);
        const online = Boolean(clientsById.get(userId)?.ws?.readyState === 1);
        return { userId, displayName: u?.displayName ?? userId, online };
      });
      safeSend(ws, { type: 'friends:list', friends, incoming, ts: nowMs() });
      return;
    }

    if (msg.type === 'friends:request') {
      if (msg.toUserId === client.userId) {
        safeSend(ws, { type: 'friends:error', message: 'self' });
        return;
      }
      if (client.friends.has(msg.toUserId)) {
        safeSend(ws, { type: 'friends:error', message: 'already_friends', toUserId: msg.toUserId });
        return;
      }

      client.outgoing.add(msg.toUserId);

      const to = clientsById.get(msg.toUserId);
      if (to) {
        to.incoming.add(client.userId);
        safeSend(to.ws, {
          type: 'friends:incoming',
          fromUserId: client.userId,
          displayName: client.displayName,
          ts: nowMs(),
        });
        const me = usersDirectory.get(client.userId);
        if (!me) usersDirectory.set(client.userId, { userId: client.userId, displayName: client.displayName });
        safeSend(ws, { type: 'friends:request:ok', toUserId: msg.toUserId, ts: nowMs() });
      } else {
        // for MVP we require recipient online to receive request
        safeSend(ws, { type: 'friends:error', message: 'user_offline_or_unknown', toUserId: msg.toUserId });
      }
      return;
    }

    if (msg.type === 'friends:accept') {
      const from = clientsById.get(msg.fromUserId);
      // allow accept if we have incoming request
      if (!client.incoming.has(msg.fromUserId)) {
        safeSend(ws, { type: 'friends:error', message: 'no_request', fromUserId: msg.fromUserId });
        return;
      }
      client.incoming.delete(msg.fromUserId);
      client.friends.add(msg.fromUserId);
      if (from) {
        from.outgoing.delete(client.userId);
        from.friends.add(client.userId);
        safeSend(from.ws, {
          type: 'friends:accepted',
          byUserId: client.userId,
          displayName: client.displayName,
          ts: nowMs(),
        });
      }
      safeSend(ws, { type: 'friends:accept:ok', fromUserId: msg.fromUserId, ts: nowMs() });
      return;
    }
  });

  ws.on('close', () => {
    if (!client) return;
    const current = clientsById.get(client.userId);
    if (current?.ws === ws) clientsById.delete(client.userId);
    for (const chatId of client.chats) {
      const members = chatMembers.get(chatId);
      if (members) {
        members.delete(client.userId);
        if (members.size === 0) chatMembers.delete(chatId);
      }
      broadcastToChat(chatId, {
        type: 'chat:presence',
        chatId,
        userId: client.userId,
        displayName: client.displayName,
        status: 'offline',
        ts: nowMs(),
      });
    }
  });
});

server.on('connection', (socket) => {
  // eslint-disable-next-line no-console
  console.log('tcp connection', {
    remoteAddress: socket?.remoteAddress,
    remotePort: socket?.remotePort,
  });
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`messenger-server listening on 0.0.0.0:${PORT}`);
});

