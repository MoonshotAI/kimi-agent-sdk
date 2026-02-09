import { create } from "zustand";
import { bridge } from "@/services";
import type { AskUserRequest } from "shared/types";

interface AskUserState {
  pending: AskUserRequest[];
  addRequest: (request: AskUserRequest) => void;
  removeRequest: (id: string) => void;
  respondToRequest: (id: string, response: string) => Promise<void>;
  clearRequests: () => void;
}

export const useAskUserStore = create<AskUserState>((set, get) => ({
  pending: [],
  addRequest: (request) => {
    set((s) => ({ pending: [...s.pending, request] }));
  },
  removeRequest: (id) => {
    set((s) => ({ pending: s.pending.filter((r) => r.id !== id) }));
  },
  respondToRequest: async (id, response) => {
    await bridge.respondAskUser(id, response);
    get().removeRequest(id);
  },
  clearRequests: () => {
    set({ pending: [] });
  },
}));
