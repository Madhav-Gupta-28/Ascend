import { useQuery } from '@tanstack/react-query';
import { fetchTopicMessages, decodeBase64Json } from '@/lib/hedera';
import { HCSMessage, PredictionMessage } from '@/lib/types';
import { TOPIC_IDS } from '@/lib/contracts';

export function useHCSMessages(topicId: string, limit: number = 50) {
    return useQuery({
        queryKey: ['hcsMessages', topicId, limit],
        queryFn: async (): Promise<{ raw: HCSMessage, parsed: any | null }[]> => {
            if (!topicId) return [];

            const rawMessages = await fetchTopicMessages(topicId, limit, 'desc');

            return rawMessages.map((msg: any) => ({
                raw: {
                    consensusTimestamp: msg.consensus_timestamp,
                    topicId: msg.topic_id,
                    message: msg.message,
                    runningHash: msg.running_hash,
                    sequenceNumber: msg.sequence_number
                },
                parsed: decodeBase64Json(msg.message)
            }));
        },
        enabled: !!topicId,
        refetchInterval: 5000, // Poll every 5s for live chat feel
    });
}

export function usePredictionsFeed(limit: number = 20) {
    return useQuery({
        queryKey: ['predictionsFeed', limit],
        queryFn: async (): Promise<{ raw: HCSMessage, parsed: PredictionMessage }[]> => {
            const topicId = TOPIC_IDS.predictions || TOPIC_IDS.legacyRounds;
            if (!topicId) return [];

            const rawMessages = await fetchTopicMessages(topicId, limit, 'desc');

            return rawMessages
                .map((msg: any) => {
                    const parsed = decodeBase64Json<PredictionMessage>(msg.message);
                    return {
                        raw: {
                            consensusTimestamp: msg.consensus_timestamp,
                            topicId: msg.topic_id,
                            message: msg.message,
                            runningHash: msg.running_hash,
                            sequenceNumber: msg.sequence_number
                        },
                        parsed
                    };
                })
                .filter((item: any) => item.parsed !== null); // Filter out unparseable messages
        },
        // We only poll this every 15s since prediction events are spaced out
        refetchInterval: 15000,
    });
}
