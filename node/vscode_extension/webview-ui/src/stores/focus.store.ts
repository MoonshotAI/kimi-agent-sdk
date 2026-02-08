import { create } from "zustand";

interface FocusState {
  isFocused: boolean;
  setFocused: (focused: boolean) => void;
}

export const useFocusStore = create<FocusState>(() => ({
  isFocused: document.hasFocus(),
  setFocused: (isFocused) => {
    useFocusStore.setState({ isFocused });
  },
}));
