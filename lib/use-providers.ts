"use client";
// lib/use-providers.ts
// SWR hook để fetch providers với:
//   - Auto-refresh mỗi 60 giây
//   - Reset state ngay khi switch network (không show stale data)
//   - Tự chọn source: KV (qua Worker) → API route fallback

import useSWR from "swr";
import { useNetwork } from "@/components/network-context";
import type { StorageProvider } from "./types";

interface ProvidersResponse {
  ok:        boolean;
  network:   string;
  source?:   string;
  data:      { providers: StorageProvider[]; count: number };
  fetchedAt: string;
  error?:    string;
}

interface UseProvidersResult {
  providers:   StorageProvider[];
  loading:     boolean;
  error:       string | null;
  source:      string;
  fetchedAt:   string | null;
  refresh:     () => void;
}

const fetcher = async (url: string): Promise<ProvidersResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export function useProviders(): UseProvidersResult {
  const { network } = useNetwork();

  const { data, error, isLoading, mutate } = useSWR<ProvidersResponse>(
    `/api/network/providers?network=${network}`,
    fetcher,
    {
      // Refresh mỗi 60s
      refreshInterval: 60_000,
      // Dedupe: không re-fetch trong 30s nếu có nhiều component dùng hook này
      dedupingInterval: 30_000,
      // Revalidate khi tab được focus lại
      revalidateOnFocus: true,
      // Giữ data cũ khi đang fetch mới (tránh flash empty)
      keepPreviousData: false, // false vì ta muốn clear khi switch network
      // Khi network thay đổi, key SWR thay đổi → tự động clear & refetch
    }
  );

  return {
    providers:  data?.data?.providers ?? [],
    loading:    isLoading,
    error:      (!data?.ok && data?.error) ? data.error : (error?.message ?? null),
    source:     data?.source ?? "unknown",
    fetchedAt:  data?.fetchedAt ?? null,
    refresh:    mutate,
  };
}