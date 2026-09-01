import type { ConfirmChannel } from "amqplib";

export const EVENTS_EXCHANGE = "evdp.events";
export const DEAD_EVENTS_EXCHANGE = `${EVENTS_EXCHANGE}.dead`;
export const MEDIA_QUEUE = "evdp.media.probe.v1";
export const DEAD_MEDIA_QUEUE = `${MEDIA_QUEUE}.dead`;
export const MEDIA_ROUTING_KEY = "media.probe.v1";
export const AI_QUALITY_QUEUE = "evdp.ai.quality.v1";
export const DEAD_AI_QUALITY_QUEUE = `${AI_QUALITY_QUEUE}.dead`;
export const AI_QUALITY_ROUTING_KEY = "ai.quality.v1";
export const AI_ANNOTATION_QUEUE = "evdp.ai.annotation.v1";
export const DEAD_AI_ANNOTATION_QUEUE = `${AI_ANNOTATION_QUEUE}.dead`;
export const AI_ANNOTATION_ROUTING_KEY = "ai.annotation.v1";
export const TASK_BOUNDARY_REFINEMENT_QUEUE = "evdp.task.boundary.refine.v1";
export const DEAD_TASK_BOUNDARY_REFINEMENT_QUEUE = `${TASK_BOUNDARY_REFINEMENT_QUEUE}.dead`;
export const TASK_BOUNDARY_REFINEMENT_ROUTING_KEY = "task.boundary.refine.v1";
export const TASK_SEGMENT_QUEUE = "evdp.task.segment.generate.v1";
export const DEAD_TASK_SEGMENT_QUEUE = `${TASK_SEGMENT_QUEUE}.dead`;
export const TASK_SEGMENT_ROUTING_KEY = "task.segment.generate.v1";
export const SUBMISSION_SOURCE_RETENTION_QUEUE = "evdp.submission.source.retention.v1";
export const DEAD_SUBMISSION_SOURCE_RETENTION_QUEUE = `${SUBMISSION_SOURCE_RETENTION_QUEUE}.dead`;
export const SUBMISSION_SOURCE_RETENTION_ROUTING_KEY = "submission.source.retention.v1";
export const MEDIA_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const AI_QUALITY_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const AI_ANNOTATION_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const TASK_BOUNDARY_REFINEMENT_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const TASK_SEGMENT_QUEUE_OPTIONS = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": DEAD_EVENTS_EXCHANGE,
  },
} as const;
export const SUBMISSION_SOURCE_RETENTION_QUEUE_OPTIONS = {
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

export async function assertAiQualityTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_AI_QUALITY_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_AI_QUALITY_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    AI_QUALITY_ROUTING_KEY,
  );
  await channel.assertQueue(AI_QUALITY_QUEUE, AI_QUALITY_QUEUE_OPTIONS);
  await channel.bindQueue(
    AI_QUALITY_QUEUE,
    EVENTS_EXCHANGE,
    AI_QUALITY_ROUTING_KEY,
  );
}

export async function assertAiAnnotationTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", {
    durable: true,
  });
  await channel.assertQueue(DEAD_AI_ANNOTATION_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_AI_ANNOTATION_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    AI_ANNOTATION_ROUTING_KEY,
  );
  await channel.assertQueue(
    AI_ANNOTATION_QUEUE,
    AI_ANNOTATION_QUEUE_OPTIONS,
  );
  await channel.bindQueue(
    AI_ANNOTATION_QUEUE,
    EVENTS_EXCHANGE,
    AI_ANNOTATION_ROUTING_KEY,
  );
}

export async function assertTaskBoundaryRefinementTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(DEAD_TASK_BOUNDARY_REFINEMENT_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_TASK_BOUNDARY_REFINEMENT_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    TASK_BOUNDARY_REFINEMENT_ROUTING_KEY,
  );
  await channel.assertQueue(
    TASK_BOUNDARY_REFINEMENT_QUEUE,
    TASK_BOUNDARY_REFINEMENT_QUEUE_OPTIONS,
  );
  await channel.bindQueue(
    TASK_BOUNDARY_REFINEMENT_QUEUE,
    EVENTS_EXCHANGE,
    TASK_BOUNDARY_REFINEMENT_ROUTING_KEY,
  );
}

export async function assertTaskSegmentTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(DEAD_TASK_SEGMENT_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_TASK_SEGMENT_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    TASK_SEGMENT_ROUTING_KEY,
  );
  await channel.assertQueue(TASK_SEGMENT_QUEUE, TASK_SEGMENT_QUEUE_OPTIONS);
  await channel.bindQueue(
    TASK_SEGMENT_QUEUE,
    EVENTS_EXCHANGE,
    TASK_SEGMENT_ROUTING_KEY,
  );
}

export async function assertSubmissionSourceRetentionTopology(
  channel: ConfirmChannel,
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(DEAD_EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(DEAD_SUBMISSION_SOURCE_RETENTION_QUEUE, { durable: true });
  await channel.bindQueue(
    DEAD_SUBMISSION_SOURCE_RETENTION_QUEUE,
    DEAD_EVENTS_EXCHANGE,
    SUBMISSION_SOURCE_RETENTION_ROUTING_KEY,
  );
  await channel.assertQueue(
    SUBMISSION_SOURCE_RETENTION_QUEUE,
    SUBMISSION_SOURCE_RETENTION_QUEUE_OPTIONS,
  );
  await channel.bindQueue(
    SUBMISSION_SOURCE_RETENTION_QUEUE,
    EVENTS_EXCHANGE,
    SUBMISSION_SOURCE_RETENTION_ROUTING_KEY,
  );
}
