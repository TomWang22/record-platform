import kafkajs from "kafkajs";
import type { ConnectionOptions } from "node:tls";
declare const Kafka: typeof kafkajs.Kafka;
export declare function loadSslFromEnv(): ConnectionOptions | undefined;
export declare function createKafkaFromEnv(): InstanceType<typeof Kafka>;
export {};
