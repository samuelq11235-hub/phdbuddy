import { useMutation } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useComputeAgreement() {
  return useMutation({
    mutationFn: (args: {
      projectId: string;
      userA: string;
      userB: string;
      documentIds?: string[];
    }) => api.computeAgreement(args),
  });
}
