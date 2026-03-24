import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import {
	createSectionLoader,
	type LoadedSection,
} from "@/stores/utils/createSectionLoader";

describe("createSectionLoader", () => {
	const sessionId = ref<string | null>("test-session");
	const loaded = ref<Set<LoadedSection>>(new Set());
	const requestToken = ref(0);
	const eventsRequestToken = ref(0);

	const context = {
		sessionId,
		loaded,
		requestToken,
		eventsRequestToken,
	};

	beforeEach(() => {
		sessionId.value = "test-session";
		loaded.value.clear();
		requestToken.value = 0;
		eventsRequestToken.value = 0;
	});

	describe("basic functionality", () => {
		it("should load data successfully and mark section as loaded", async () => {
			const mockData = { value: "test" };
			const fetcher = vi.fn().mockResolvedValue(mockData);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(dataRef.value).toEqual(mockData);
			expect(errorRef.value).toBeNull();
			expect(loaded.value.has("turns")).toBe(true);
			expect(fetcher).toHaveBeenCalledWith("test-session");
		});

		it("should do nothing when sessionId is null", async () => {
			sessionId.value = null;
			const fetcher = vi.fn();
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(fetcher).not.toHaveBeenCalled();
			expect(loaded.value.has("turns")).toBe(false);
		});

		it("should skip fetch if section already loaded", async () => {
			loaded.value.add("turns");
			const fetcher = vi.fn();
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(fetcher).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should set error on fetch failure", async () => {
			const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(dataRef.value).toBeNull();
			expect(errorRef.value).toBe("Network error");
			expect(loaded.value.has("turns")).toBe(false);
		});

		it("should handle non-Error rejections", async () => {
			const fetcher = vi.fn().mockRejectedValue("String error");
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(errorRef.value).toBe("String error");
		});

		it("should clear previous error before retry", async () => {
			const fetcher = vi
				.fn()
				.mockRejectedValueOnce(new Error("First error"))
				.mockResolvedValueOnce({ value: "success" });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			// First call - fails
			await loader();
			expect(errorRef.value).toBe("First error");

			// Clear loaded to allow retry
			loaded.value.delete("turns");

			// Second call - succeeds
			await loader();
			expect(errorRef.value).toBeNull();
			expect(dataRef.value).toEqual({ value: "success" });
		});
	});

	describe("stale request handling", () => {
		it("should discard stale response when token changes", async () => {
			let resolveFetch: (value: unknown) => void;
			const fetcher = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveFetch = resolve;
					}),
			);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			const fetchPromise = loader();

			// Simulate session switch
			requestToken.value++;

			resolveFetch({ value: "stale" });
			await fetchPromise;

			// Data should NOT be updated
			expect(dataRef.value).toBeNull();
			expect(loaded.value.has("turns")).toBe(false);
		});

		it("should discard stale error when token changes", async () => {
			let rejectFetch: (error: unknown) => void;
			const fetcher = vi.fn().mockImplementation(
				() =>
					new Promise((_, reject) => {
						rejectFetch = reject;
					}),
			);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			const fetchPromise = loader();

			// Simulate session switch
			requestToken.value++;

			rejectFetch(new Error("Stale error"));
			await fetchPromise;

			// Error should NOT be set
			expect(errorRef.value).toBeNull();
		});
	});

	describe("onSuccess callback", () => {
		it("should call onSuccess hook after successful fetch", async () => {
			const mockData = { value: "test", extra: 123 };
			const fetcher = vi.fn().mockResolvedValue(mockData);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);
			const onSuccess = vi.fn();

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
				onSuccess,
			});

			await loader();

			expect(onSuccess).toHaveBeenCalledWith(mockData);
		});

		it("should not call onSuccess on failure", async () => {
			const fetcher = vi.fn().mockRejectedValue(new Error("Failed"));
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);
			const onSuccess = vi.fn();

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
				onSuccess,
			});

			await loader();

			expect(onSuccess).not.toHaveBeenCalled();
		});

		it("should not call onSuccess on stale response", async () => {
			let resolveFetch: (value: unknown) => void;
			const fetcher = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveFetch = resolve;
					}),
			);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);
			const onSuccess = vi.fn();

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
				onSuccess,
			});

			const fetchPromise = loader();
			requestToken.value++;
			resolveFetch({ value: "stale" });
			await fetchPromise;

			expect(onSuccess).not.toHaveBeenCalled();
		});
	});

	describe("skipLoadedCheck option", () => {
		it("should skip loaded check when skipLoadedCheck is true", async () => {
			loaded.value.add("events");
			const fetcher = vi.fn().mockResolvedValue({ value: "test" });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "events",
				fetcher,
				dataRef,
				errorRef,
				skipLoadedCheck: true,
			});

			await loader();

			// Should fetch even though marked as loaded
			expect(fetcher).toHaveBeenCalled();
			expect(dataRef.value).toEqual({ value: "test" });
		});

		it("should not mark section as loaded when skipLoadedCheck is true", async () => {
			const fetcher = vi.fn().mockResolvedValue({ value: "test" });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "events",
				fetcher,
				dataRef,
				errorRef,
				skipLoadedCheck: true,
			});

			await loader();

			expect(loaded.value.has("events")).toBe(false);
		});
	});

	describe("useEventsToken option", () => {
		it("should use eventsRequestToken when useEventsToken is true", async () => {
			const fetcher = vi.fn().mockResolvedValue({ value: "test" });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "events",
				fetcher,
				dataRef,
				errorRef,
				useEventsToken: true,
			});

			const initialToken = eventsRequestToken.value;
			await loader();

			expect(eventsRequestToken.value).toBe(initialToken + 1);
			expect(requestToken.value).toBe(0); // Should not change
		});

		it("should check eventsRequestToken for stale responses", async () => {
			let resolveFetch: (value: unknown) => void;
			const fetcher = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveFetch = resolve;
					}),
			);
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "events",
				fetcher,
				dataRef,
				errorRef,
				useEventsToken: true,
			});

			const fetchPromise = loader();

			// Change events token (e.g., new pagination request)
			eventsRequestToken.value++;

			resolveFetch({ value: "stale" });
			await fetchPromise;

			// Data should NOT be updated
			expect(dataRef.value).toBeNull();
		});
	});

	describe("parameterized loaders", () => {
		it("should support loaders with parameters", async () => {
			const fetcher = vi.fn().mockResolvedValue({ events: [] });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader<unknown, [number, number, string?]>(
				context,
				{
					key: "events",
					fetcher,
					dataRef,
					errorRef,
				},
			);

			await loader(0, 100, "tool_call");

			expect(fetcher).toHaveBeenCalledWith("test-session", 0, 100, "tool_call");
		});

		it("should support optional parameters", async () => {
			const fetcher = vi.fn().mockResolvedValue({ events: [] });
			const dataRef = ref(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader<unknown, [number, number, string?]>(
				context,
				{
					key: "events",
					fetcher,
					dataRef,
					errorRef,
				},
			);

			await loader(0, 100);

			expect(fetcher).toHaveBeenCalledWith("test-session", 0, 100);
		});
	});

	describe("type safety", () => {
		it("should work with array data refs", async () => {
			const mockData = [{ id: 1 }, { id: 2 }];
			const fetcher = vi.fn().mockResolvedValue(mockData);
			const dataRef = ref<Array<{ id: number }>>([]);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "turns",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(dataRef.value).toEqual(mockData);
		});

		it("should work with object data refs", async () => {
			const mockData = { key: "value", count: 42 };
			const fetcher = vi.fn().mockResolvedValue(mockData);
			const dataRef = ref<{ key: string; count: number } | null>(null);
			const errorRef = ref<string | null>(null);

			const loader = createSectionLoader(context, {
				key: "todos",
				fetcher,
				dataRef,
				errorRef,
			});

			await loader();

			expect(dataRef.value).toEqual(mockData);
		});
	});
});
