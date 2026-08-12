import type { ConfirmChannel } from "amqplib";

export const EVENTS_EXCHANGE = "evdp.events";
export const DEAD_EVENTS_EXCHANGE = `${EVENTS_EXCHANGE}.dead`;
export const MEDIA_QUEUE = "evdp.media.probe.v1";
export const DEAD_MEDIA_QUEUE = `${MEDIA_QUEUE}.dead`;
export const MEDIA_ROUTING_KEY = "media.probe.v1";
export const MEDIA_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;

export async function assertMediaTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_MEDIA_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_MEDIA_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    MEDIA_ROUTING_KEY,
  );
  await channel.assertQueue(MEDIA_QUEUE, MEDIA_QUEUE_OPTIONS);
  await channel.bindQueue(MEDIA_QUEUE, EVENTS_EXCHANGE, MEDIA_ROUTING_KEY);
}
