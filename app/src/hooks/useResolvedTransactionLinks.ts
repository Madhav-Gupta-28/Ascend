"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hashscanTransactionUrl } from "@/lib/explorer";

const txUrlCache = new Map<string, string>();
const inflightResolutions = new Map<string, Promise<string>>();

function normalizeInput(value: string | null | undefined): string | null {
    const trimmed = String(value || "").trim();
    return trimmed.length > 0 ? trimmed : null;
}

async function resolveTransactionLink(id: string): Promise<string> {
    const cached = txUrlCache.get(id);
    if (cached) return cached;

    const existing = inflightResolutions.get(id);
    if (existing) return existing;

    const promise = fetch(`/api/mirror/transactions/resolve?id=${encodeURIComponent(id)}`)
        .then(async (res) => {
            const data = await res.json().catch(() => null);
            const href =
                typeof data?.hashscanUrl === "string" && data.hashscanUrl.length > 0
                    ? data.hashscanUrl
                    : hashscanTransactionUrl(id);
            txUrlCache.set(id, href);
            return href;
        })
        .catch(() => {
            const fallback = hashscanTransactionUrl(id);
            txUrlCache.set(id, fallback);
            return fallback;
        })
        .finally(() => {
            inflightResolutions.delete(id);
        });

    inflightResolutions.set(id, promise);
    return promise;
}

export function useResolvedTransactionLinks(ids: Array<string | null | undefined>) {
    const [version, setVersion] = useState(0);

    const normalizedIds = useMemo(
        () => Array.from(new Set(ids.map(normalizeInput).filter((value): value is string => value !== null))),
        [ids],
    );

    useEffect(() => {
        let cancelled = false;
        const unresolved = normalizedIds.filter((id) => !txUrlCache.has(id));
        if (unresolved.length === 0) return;

        Promise.all(unresolved.map((id) => resolveTransactionLink(id))).then(() => {
            if (cancelled) return;
            setVersion((v) => v + 1);
        });

        return () => {
            cancelled = true;
        };
    }, [normalizedIds]);

    const getTransactionUrl = useCallback(
        (id: string | null | undefined): string | null => {
            const normalized = normalizeInput(id);
            if (!normalized) return null;
            return txUrlCache.get(normalized) ?? hashscanTransactionUrl(normalized);
        },
        [version],
    );

    return { getTransactionUrl };
}
