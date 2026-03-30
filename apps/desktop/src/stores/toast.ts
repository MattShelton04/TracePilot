import { useToast } from "@tracepilot/ui";
import { defineStore } from "pinia";

export const useToastStore = defineStore("toast", () => {
  const { toasts, toast, success, error, warning, info, dismiss, clear } = useToast();
  return { toasts, toast, success, error, warning, info, dismiss, clear };
});
