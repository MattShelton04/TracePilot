/**
 * A simple Least Recently Used (LRU) cache implementation.
 *
 * Items are automatically evicted when the cache exceeds maxSize.
 * Access (get) moves items to the end, making them "most recently used".
 *
 * @template K - Key type
 * @template V - Value type
 */
export class LRUCache<K, V> {
	private cache = new Map<K, V>();
	private maxSize: number;

	/**
	 * Creates a new LRU cache.
	 *
	 * @param maxSize - Maximum number of items to store
	 */
	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	/**
	 * Gets a value from the cache.
	 * Accessing an item moves it to the end (most recently used position).
	 *
	 * @param key - The key to look up
	 * @returns The value if found, undefined otherwise
	 */
	get(key: K): V | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			// Move to end (most recent)
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
	}

	/**
	 * Sets a value in the cache.
	 * Adding or updating an item moves it to the end (most recently used position).
	 * If the cache exceeds maxSize, the oldest item is evicted.
	 *
	 * @param key - The key to store
	 * @param value - The value to store
	 */
	set(key: K, value: V): void {
		// Delete and re-add to update position
		this.cache.delete(key);
		this.cache.set(key, value);

		if (this.cache.size > this.maxSize) {
			// First key is oldest (insertion order)
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) {
				this.cache.delete(oldest);
			}
		}
	}

	/**
	 * Checks if a key exists in the cache.
	 * Does NOT update access time.
	 *
	 * @param key - The key to check
	 * @returns true if the key exists
	 */
	has(key: K): boolean {
		return this.cache.has(key);
	}

	/**
	 * Clears all items from the cache.
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Gets the current size of the cache.
	 */
	get size(): number {
		return this.cache.size;
	}
}
