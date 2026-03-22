import { defineStore } from "pinia";
import { useToast } from "@tracepilot/ui";

export const useToastStore = defineStore("toast", () => {
  const { toasts, toast, success, error, warning, info, dismiss, clear } = useToast();
  return { toasts, toast, success, error, warning, info, dismiss, clear };
});
