import type { Redis } from "ioredis";

export interface TicketEvent {
  type: "ticket.message" | "ticket.status_changed";
  ticketId: string;
  orgId: string;
  payload: Record<string, unknown>;
}

function channelFor(orgId: string): string {
  return `ticket-events:${orgId}`;
}

// A dedicated publish-only connection is cheap and reused across requests.
export class TicketEventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: TicketEvent): Promise<void> {
    await this.redis.publish(channelFor(event.orgId), JSON.stringify(event));
  }
}

// Subscriber connections in Redis can ONLY subscribe/unsubscribe once in
// (P)SUBSCRIBE mode - ioredis enforces this by giving each subscription its
// own duplicated connection, which is why this takes a factory rather than
// a shared client.
export class TicketEventSubscriber {
  private readonly redis: Redis;

  constructor(redisFactory: () => Redis) {
    this.redis = redisFactory();
  }

  async subscribeToOrg(orgId: string, onEvent: (event: TicketEvent) => void): Promise<() => Promise<void>> {
    const channel = channelFor(orgId);
    const listener = (chan: string, message: string) => {
      if (chan !== channel) return;
      onEvent(JSON.parse(message) as TicketEvent);
    };

    this.redis.on("message", listener);
    await this.redis.subscribe(channel);

    return async () => {
      this.redis.off("message", listener);
      await this.redis.unsubscribe(channel);
      this.redis.disconnect();
    };
  }
}
