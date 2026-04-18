import type { ITopicMetadata } from "kafkajs";
import type { KafkaContractConfig, ValidationReport } from "./types.js";
export declare function validateContract(config: KafkaContractConfig, expectedTopics: string[], topicMetadata: {
    topics: ITopicMetadata[];
}, brokerConfigEntries: {
    name: string;
    value: string;
}[] | null, clusterBrokerCount: number): ValidationReport;
