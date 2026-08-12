export const MESSAGE_BUS = Symbol("MESSAGE_BUS");

export type PublishMessage = {
  messageId: string;
  routingKey: string;
  payload: Record<string, unknown>;
};

export interface MessageBusPort {
  publish(message: PublishMessage): Promise<void>;
  close(): Promise<void>;
}
