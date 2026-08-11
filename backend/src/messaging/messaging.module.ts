import {
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import {
  MESSAGE_BUS,
  type MessageBusPort,
} from "./message-bus.port.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import { OutboxPumpService } from "./outbox-pump.service.js";
import { RabbitMqMessageBusService } from "./rabbitmq-message-bus.service.js";

function rabbitUrl(): string {
  const value = process.env.RABBITMQ_URL?.trim();
  if (!value) throw new Error("RABBITMQ_URL is required");
  return value;
}

@Module({
  providers: [
    {
      provide: MESSAGE_BUS,
      useFactory: () => new RabbitMqMessageBusService(rabbitUrl()),
    },
    OutboxPublisherService,
    OutboxPumpService,
  ],
  exports: [MESSAGE_BUS, OutboxPublisherService],
})
export class MessagingModule implements OnApplicationShutdown {
  constructor(
    @Inject(MESSAGE_BUS) private readonly bus: MessageBusPort,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
