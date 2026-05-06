import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

// All three are mutations (not queries) because the server compute is
// non-trivial and the user explicitly clicks "analyse" — we don't want
// the cache fighting them on every project switch.

export function useTextFrequency() {
  return useMutation({
    mutationFn: (args: { projectId: string; topN?: number; documentIds?: string[] }) =>
      api.textFrequency(args),
  });
}

export function useTextKwic() {
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      term: string;
      context?: number;
      caseSensitive?: boolean;
      documentIds?: string[];
    }) => api.textKwic(args),
  });
}

export function useCooccurrence() {
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      scope?: "quotation" | "document";
      documentIds?: string[];
    }) => api.textCooccurrence(args),
  });
}
