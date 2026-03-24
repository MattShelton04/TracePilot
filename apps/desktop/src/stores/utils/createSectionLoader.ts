import type { Ref } from "vue";

/**
 * Type definition for loaded sections in the session detail store.
 */
export type LoadedSection =
	| "detail"
	| "turns"
	| "events"
	| "todos"
	| "checkpoints"
	| "plan"
	| "metrics"
	| "incidents";

/**
 * Configuration for a section loader function.
 *
 * @template TResult - The type of data returned by the fetcher
 * @template TParams - Tuple type for additional parameters passed to the fetcher
 */
interface SectionLoaderConfig<TResult, TParams extends unknown[] = []> {
	/** Section key for tracking loaded state */
	key: LoadedSection;

	/** API fetch function that takes sessionId and optional params */
	fetcher: (sessionId: string, ...params: TParams) => Promise<TResult>;

	/** Ref to store the fetched data */
	dataRef: Ref<TResult | null> | Ref<TResult[] | null> | Ref<TResult>;

	/** Ref to store any error message */
	errorRef: Ref<string | null>;

	/** Optional callback invoked after successful fetch */
	onSuccess?: (result: TResult) => void;

	/** Skip the loaded check (for loaders that always re-fetch like events) */
	skipLoadedCheck?: boolean;

	/** Use separate events token for pagination within the same session */
	useEventsToken?: boolean;
}

/**
 * Context passed to loader factory containing shared store state.
 */
interface LoaderContext {
	/** Current session ID */
	sessionId: Ref<string | null>;

	/** Set tracking which sections have been loaded */
	loaded: Ref<Set<LoadedSection>>;

	/** Main request token for detecting stale requests across session switches */
	requestToken: Ref<number>;

	/** Separate token for events pagination within the same session */
	eventsRequestToken: Ref<number>;
}

/**
 * Creates a typed async loader function for a session data section.
 *
 * This factory handles the common pattern for loading session data:
 * - Validates session ID exists
 * - Generates and validates request tokens to prevent stale updates
 * - Handles errors consistently
 * - Tracks loaded state
 * - Supports optional success callbacks
 *
 * Does NOT handle complex business logic like:
 * - Caching (store's responsibility)
 * - Freshness checks (store's responsibility)
 * - Background refreshes (store's responsibility)
 *
 * @template TResult - The type of data returned by the fetcher
 * @template TParams - Tuple type for additional parameters
 * @param context - Shared store context (sessionId, tokens, loaded set)
 * @param config - Loader configuration
 * @returns An async function that loads the section data
 *
 * @example
 * ```typescript
 * const loadTurns = createSectionLoader(context, {
 *   key: 'turns',
 *   fetcher: getSessionTurns,
 *   dataRef: turns,
 *   errorRef: turnsError,
 *   onSuccess: (result) => {
 *     lastEventsFileSize.value = result.eventsFileSize;
 *   },
 * });
 *
 * // Use like any other async function
 * await loadTurns();
 * ```
 */
export function createSectionLoader<TResult, TParams extends unknown[] = []>(
	context: LoaderContext,
	config: SectionLoaderConfig<TResult, TParams>,
): (...params: TParams) => Promise<void> {
	return async (...params: TParams): Promise<void> => {
		const id = context.sessionId.value;
		if (!id) return;

		// Skip if already loaded (unless explicitly disabled)
		if (!config.skipLoadedCheck && context.loaded.value.has(config.key)) {
			return;
		}

		// Determine which token to use
		const tokenRef = config.useEventsToken
			? context.eventsRequestToken
			: context.requestToken;

		// Increment token if using events token (for pagination)
		const token = config.useEventsToken
			? ++context.eventsRequestToken.value
			: context.requestToken.value;

		// Clear previous error
		config.errorRef.value = null;

		try {
			const result = await config.fetcher(id, ...params);

			// Stale check - discard if token has changed
			if (tokenRef.value !== token) return;

			// Update data
			config.dataRef.value = result as never;

			// Optional post-success hook
			if (config.onSuccess) {
				config.onSuccess(result);
			}

			// Mark as loaded
			if (!config.skipLoadedCheck) {
				context.loaded.value.add(config.key);
			}
		} catch (e) {
			// Stale check - don't update error state if stale
			if (tokenRef.value !== token) return;

			// Format and store error
			config.errorRef.value = e instanceof Error ? e.message : String(e);

			// Log error for debugging
			console.error(`Failed to load ${config.key}:`, e);
		}
	};
}
