import { z } from "zod";

export class RoomsDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private clientsById = new Map<
    string,
    {
      userId: string;
      displayName: string;
      ws: WebSocket;
      chats: Set<string>;
      friends: Set<string>;
      incoming: Set<string>;
      outgoing: Set<string>;
    }
  >();

  private usersDirectory = new Map<string, { userId: string; displayName: string }>();
  private chatMembers = new Map<string, Set<string>>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private nowMs() {
    return Date.now();
  }

  private safeSend(ws: WebSocket, obj: any) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  private broadcastToChat(chatId: string, obj: any) {
    const members = this.chatMembers.get(chatId);
    if (!members) return;
    for (const userId of members) {
      const c = this.clientsById.get(userId);
      if (!c) continue;
      this.safeSend(c.ws, obj);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const clientSide = pair[0];
    const serverSide = pair[1];
    serverSide.accept();

    let client:
      | null
      | {
          userId: string;
          displayName: string;
          ws: WebSocket;
          chats: Set<string>;
          friends: Set<string>;
          incoming: Set<string>;
          outgoing: Set<string>;
        } = null;

    this.safeSend(serverSide, { type: "server:hello", ts: this.nowMs() });

    serverSide.addEventListener("message", (ev) => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch {
        this.safeSend(serverSide, { type: "error", message: "bad_json" });
        return;
      }

      const v = Inbound.safeParse(parsed);
      if (!v.success) {
        this.safeSend(serverSide, { type: "error", message: "bad_message", details: v.error.issues });
        return;
      }
      const msg = v.data;

      if (msg.type === "hello") {
        const existing = this.clientsById.get(msg.userId);
        if (existing) {
          this.safeSend(existing.ws, { type: "server:kick", reason: "new_session" });
          try {
            existing.ws.close(4000, "new_session");
          } catch {}
        }

        const prev = this.clientsById.get(msg.userId);
        client = {
          ws: serverSide,
          userId: msg.userId,
          displayName: msg.displayName,
          chats: new Set(),
          friends: prev?.friends ?? new Set(),
          incoming: prev?.incoming ?? new Set(),
          outgoing: prev?.outgoing ?? new Set(),
        };
        this.clientsById.set(msg.userId, client);
        this.usersDirectory.set(msg.userId, { userId: msg.userId, displayName: msg.displayName });
        this.safeSend(serverSide, { type: "hello:ack", userId: msg.userId, ts: this.nowMs() });
        return;
      }

      if (!client) {
        this.safeSend(serverSide, { type: "error", message: "not_hello" });
        return;
      }

      if (msg.type === "join") {
        client.chats.add(msg.chatId);
        if (!this.chatMembers.has(msg.chatId)) this.chatMembers.set(msg.chatId, new Set());
        this.chatMembers.get(msg.chatId)!.add(client.userId);

        this.safeSend(serverSide, { type: "chat:joined", chatId: msg.chatId, ts: this.nowMs() });
        this.broadcastToChat(msg.chatId, {
          type: "chat:presence",
          chatId: msg.chatId,
          userId: client.userId,
          displayName: client.displayName,
          status: "online",
          ts: this.nowMs(),
        });
        return;
      }

      if (msg.type === "chat:message") {
        this.broadcastToChat(msg.chatId, {
          type: "chat:message",
          chatId: msg.chatId,
          fromUserId: client.userId,
          displayName: client.displayName,
          clientMsgId: msg.clientMsgId,
          text: msg.text ?? "",
          audioBase64: msg.audioBase64 ?? null,
          audioMime: msg.audioMime ?? null,
          ts: this.nowMs(),
        });
        return;
      }

      if (msg.type === "signal") {
        const to = this.clientsById.get(msg.toUserId);
        if (!to) {
          this.safeSend(serverSide, { type: "signal:error", toUserId: msg.toUserId, message: "offline" });
          return;
        }
        this.safeSend(to.ws, { type: "signal", fromUserId: client.userId, payload: msg.payload, ts: this.nowMs() });
        return;
      }

      if (msg.type === "call:invite") {
        const to = this.clientsById.get(msg.toUserId);
        if (!to) {
          this.safeSend(serverSide, { type: "call:invite:error", toUserId: msg.toUserId, callId: msg.callId, message: "offline" });
          return;
        }
        this.safeSend(to.ws, {
          type: "call:invite",
          fromUserId: client.userId,
          fromDisplayName: client.displayName,
          callId: msg.callId,
          ts: this.nowMs(),
        });
        this.safeSend(serverSide, { type: "call:invite:ok", toUserId: msg.toUserId, callId: msg.callId, ts: this.nowMs() });
        return;
      }

      if (msg.type === "call:accept" || msg.type === "call:reject" || msg.type === "call:hangup") {
        const to = this.clientsById.get(msg.toUserId);
        if (!to) return;
        this.safeSend(to.ws, {
          type: msg.type,
          fromUserId: client.userId,
          fromDisplayName: client.displayName,
          callId: msg.callId,
          ts: this.nowMs(),
        });
        return;
      }

      if (msg.type === "friends:list") {
        const friends = Array.from(client.friends).map((userId) => {
          const u = this.usersDirectory.get(userId);
          const online = Boolean(this.clientsById.get(userId));
          return { userId, displayName: u?.displayName ?? userId, online };
        });
        const incoming = Array.from(client.incoming).map((userId) => {
          const u = this.usersDirectory.get(userId);
          const online = Boolean(this.clientsById.get(userId));
          return { userId, displayName: u?.displayName ?? userId, online };
        });
        this.safeSend(serverSide, { type: "friends:list", friends, incoming, ts: this.nowMs() });
        return;
      }

      if (msg.type === "friends:request") {
        if (msg.toUserId === client.userId) {
          this.safeSend(serverSide, { type: "friends:error", message: "self" });
          return;
        }
        if (client.friends.has(msg.toUserId)) {
          this.safeSend(serverSide, { type: "friends:error", message: "already_friends", toUserId: msg.toUserId });
          return;
        }

        client.outgoing.add(msg.toUserId);
        const to = this.clientsById.get(msg.toUserId);
        if (to) {
          to.incoming.add(client.userId);
          this.safeSend(to.ws, { type: "friends:incoming", fromUserId: client.userId, displayName: client.displayName, ts: this.nowMs() });
          this.safeSend(serverSide, { type: "friends:request:ok", toUserId: msg.toUserId, ts: this.nowMs() });
        } else {
          this.safeSend(serverSide, { type: "friends:error", message: "user_offline_or_unknown", toUserId: msg.toUserId });
        }
        return;
      }

      if (msg.type === "friends:accept") {
        const fromId = msg.fromUserId;
        if (!client.incoming.has(fromId)) {
          this.safeSend(serverSide, { type: "friends:error", message: "no_request", fromUserId: fromId });
          return;
        }
        client.incoming.delete(fromId);
        client.friends.add(fromId);

        const from = this.clientsById.get(fromId);
        if (from) {
          from.outgoing.delete(client.userId);
          from.friends.add(client.userId);
          this.safeSend(from.ws, { type: "friends:accepted", byUserId: client.userId, displayName: client.displayName, ts: this.nowMs() });
        }
        this.safeSend(serverSide, { type: "friends:accept:ok", fromUserId: fromId, ts: this.nowMs() });
        return;
      }

      if (msg.type === "ping") {
        this.safeSend(serverSide, { type: "pong", ts: this.nowMs(), echoTs: msg.ts ?? null });
        return;
      }
    });

    serverSide.addEventListener("close", () => {
      if (!client) return;
      const current = this.clientsById.get(client.userId);
      if (current?.ws === serverSide) this.clientsById.delete(client.userId);

      for (const chatId of client.chats) {
        const members = this.chatMembers.get(chatId);
        if (members) {
          members.delete(client.userId);
          if (members.size === 0) this.chatMembers.delete(chatId);
        }
        this.broadcastToChat(chatId, {
          type: "chat:presence",
          chatId,
          userId: client.userId,
          displayName: client.displayName,
          status: "offline",
          ts: this.nowMs(),
        });
      }
    });

    return new Response(null, { status: 101, webSocket: clientSide });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });

    const id = env.ROOMS.idFromName("global");
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;

type Env = {
  ROOMS: DurableObjectNamespace<RoomsDO>;
};

const ClientHello = z.object({
  type: z.literal("hello"),
  userId: z.string().min(1),
  displayName: z.string().min(1).max(64),
});
const Join = z.object({ type: z.literal("join"), chatId: z.string().min(1) });
const ChatMessage = z.object({
  type: z.literal("chat:message"),
  chatId: z.string().min(1),
  clientMsgId: z.string().min(1),
  text: z.string().max(4000).optional(),
  audioBase64: z.string().optional(),
  audioMime: z.string().optional(),
});
const Signal = z.object({ type: z.literal("signal"), toUserId: z.string().min(1), payload: z.any() });
const FriendsRequest = z.object({ type: z.literal("friends:request"), toUserId: z.string().min(1) });
const FriendsAccept = z.object({ type: z.literal("friends:accept"), fromUserId: z.string().min(1) });
const FriendsList = z.object({ type: z.literal("friends:list") });
const CallInvite = z.object({ type: z.literal("call:invite"), toUserId: z.string().min(1), callId: z.string().min(1) });
const CallAccept = z.object({ type: z.literal("call:accept"), toUserId: z.string().min(1), callId: z.string().min(1) });
const CallReject = z.object({ type: z.literal("call:reject"), toUserId: z.string().min(1), callId: z.string().min(1) });
const CallHangup = z.object({ type: z.literal("call:hangup"), toUserId: z.string().min(1), callId: z.string().min(1) });
const Ping = z.object({ type: z.literal("ping"), ts: z.number().optional() });

const Inbound = z.discriminatedUnion("type", [
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
  Ping,
]);

