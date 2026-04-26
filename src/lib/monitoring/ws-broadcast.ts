import type { WebSocket } from "ws";
import type { MetricsCollector } from "./collector";
import type { MonFrame } from "./types";

/**
 * Pub-sub registry for /ws/monitoring. Tracks each connected client's
 * subscribed topics and pushes only relevant frames. The MetricsCollector
 * subscribes us as a listener; we relay snapshots to interested clients.
 */
export class MonitoringBroadcaster {
  private readonly clients = new Map<WebSocket, Set<string>>();
  private unsubFromCollector: (() => void) | null = null;

  attach(collector: MetricsCollector): void {
    this.unsubFromCollector = collector.subscribe((key, snapshot) => {
      const topic = `snapshot.${key}`;
      this.broadcast(topic, { type: "event", topic, payload: snapshot });
    });
  }

  detach(): void {
    if (this.unsubFromCollector) {
      this.unsubFromCollector();
      this.unsubFromCollector = null;
    }
    for (const ws of this.clients.keys()) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  register(ws: WebSocket): void {
    this.clients.set(ws, new Set());
    ws.on("close", () => {
      this.clients.delete(ws);
    });
    ws.on("error", () => {
      this.clients.delete(ws);
    });
  }

  /** Handle an inbound frame from a client. */
  handleFrame(ws: WebSocket, frame: MonFrame): void {
    const topics = this.clients.get(ws);
    if (!topics) return;
    switch (frame.type) {
      case "subscribe":
        for (const t of frame.topics) topics.add(t);
        break;
      case "unsubscribe":
        for (const t of frame.topics) topics.delete(t);
        break;
      case "ping":
        send(ws, { type: "pong", t: Date.now() });
        break;
      default:
        /* ignore */
        break;
    }
  }

  /** Push a frame to all clients subscribed to `topic` (or wildcard `*`). */
  broadcast(topic: string, frame: MonFrame): void {
    const payload = JSON.stringify(frame);
    for (const [ws, topics] of this.clients) {
      if (!topicMatches(topics, topic)) continue;
      try {
        ws.send(payload);
      } catch {
        /* dead socket, gc on close */
      }
    }
  }

  /** Number of currently connected monitoring clients. */
  size(): number {
    return this.clients.size;
  }
}

function topicMatches(subscribed: Set<string>, topic: string): boolean {
  if (subscribed.has(topic)) return true;
  if (subscribed.has("*")) return true;
  // Prefix wildcards: "docker:*" matches "docker:abc123".
  for (const t of subscribed) {
    if (t.endsWith(":*") && topic.startsWith(t.slice(0, -1))) return true;
    if (t.endsWith(".*") && topic.startsWith(t.slice(0, -1))) return true;
  }
  return false;
}

function send(ws: WebSocket, frame: MonFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    /* ignore */
  }
}

let _instance: MonitoringBroadcaster | null = null;
export function getMonitoringBroadcaster(): MonitoringBroadcaster {
  if (!_instance) _instance = new MonitoringBroadcaster();
  return _instance;
}
