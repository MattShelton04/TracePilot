import { describe, expect, it } from "vitest";
import { deepClone } from "../clone";

describe("deepClone", () => {
  describe("primitives", () => {
    it("clones string values", () => {
      expect(deepClone("hello")).toBe("hello");
    });

    it("clones number values", () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone(3.14)).toBe(3.14);
    });

    it("clones boolean values", () => {
      expect(deepClone(true)).toBe(true);
      expect(deepClone(false)).toBe(false);
    });

    it("clones null", () => {
      expect(deepClone(null)).toBe(null);
    });

    it("clones undefined", () => {
      expect(deepClone(undefined)).toBe(undefined);
    });
  });

  describe("objects", () => {
    it("clones plain objects", () => {
      const original = { name: "test", value: 42 };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it("clones nested objects", () => {
      const original = {
        name: "parent",
        child: {
          name: "child",
          grandchild: {
            value: 123,
          },
        },
      };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.child).not.toBe(original.child);
      expect(cloned.child.grandchild).not.toBe(original.child.grandchild);
    });

    it("creates independent copies (mutations don't affect original)", () => {
      const original = { name: "test", config: { enabled: true } };
      const cloned = deepClone(original);

      cloned.name = "modified";
      cloned.config.enabled = false;

      expect(original.name).toBe("test");
      expect(original.config.enabled).toBe(true);
    });

    it("handles empty objects", () => {
      const original = {};
      const cloned = deepClone(original);

      expect(cloned).toEqual({});
      expect(cloned).not.toBe(original);
    });

    it("handles objects with null values", () => {
      const original = { value: null, nested: { prop: null } };
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });
  });

  describe("arrays", () => {
    it("clones simple arrays", () => {
      const original = [1, 2, 3];
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });

    it("clones arrays of objects", () => {
      const original = [{ id: 1 }, { id: 2 }];
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[0]).not.toBe(original[0]);
      expect(cloned[1]).not.toBe(original[1]);
    });

    it("clones nested arrays", () => {
      const original = [
        [1, 2],
        [3, 4],
      ];
      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[0]).not.toBe(original[0]);
    });

    it("creates independent array copies", () => {
      const original = [{ value: 1 }, { value: 2 }];
      const cloned = deepClone(original);

      cloned[0].value = 999;
      cloned.push({ value: 3 });

      expect(original[0].value).toBe(1);
      expect(original.length).toBe(2);
    });

    it("handles empty arrays", () => {
      const original: number[] = [];
      const cloned = deepClone(original);

      expect(cloned).toEqual([]);
      expect(cloned).not.toBe(original);
    });
  });

  describe("Date objects", () => {
    it("clones Date objects (when structuredClone available)", () => {
      const original = new Date("2024-01-15T10:30:00Z");
      const cloned = deepClone(original);

      // structuredClone preserves Date objects
      if (typeof structuredClone !== "undefined") {
        expect(cloned).toEqual(original);
        expect(cloned).toBeInstanceOf(Date);
        expect(cloned).not.toBe(original);
      } else {
        // JSON fallback converts to string
        expect(typeof cloned).toBe("string");
      }
    });

    it("clones objects containing Date objects", () => {
      const original = {
        timestamp: new Date("2024-01-15T10:30:00Z"),
        name: "test",
      };
      const cloned = deepClone(original);

      if (typeof structuredClone !== "undefined") {
        expect(cloned.timestamp).toBeInstanceOf(Date);
        expect(cloned.timestamp).toEqual(original.timestamp);
      }
      expect(cloned.name).toBe("test");
    });
  });

  describe("mixed types", () => {
    it("clones complex nested structures", () => {
      const original = {
        id: "test-123",
        name: "Complex Object",
        enabled: true,
        count: 42,
        metadata: null,
        tags: ["tag1", "tag2"],
        config: {
          nested: {
            deep: {
              value: "deep-value",
            },
          },
          items: [
            { id: 1, label: "First" },
            { id: 2, label: "Second" },
          ],
        },
      };

      const cloned = deepClone(original);

      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.config).not.toBe(original.config);
      expect(cloned.config.nested).not.toBe(original.config.nested);
      expect(cloned.config.items).not.toBe(original.config.items);
      expect(cloned.config.items[0]).not.toBe(original.config.items[0]);
    });

    it("maintains type information", () => {
      interface TestType {
        name: string;
        value: number;
      }

      const original: TestType = { name: "test", value: 42 };
      const cloned: TestType = deepClone(original);

      // TypeScript should preserve type through generic
      expect(cloned.name).toBe("test");
      expect(cloned.value).toBe(42);
    });
  });

  describe("real-world use cases", () => {
    it("clones TaskPreset-like objects", () => {
      const preset = {
        id: "preset-123",
        name: "Test Preset",
        builtin: false,
        enabled: true,
        createdAt: "2024-01-15T10:30:00Z",
        updatedAt: "2024-01-15T10:30:00Z",
        config: {
          sources: [
            {
              type: "session_export",
              config: { sections: ["overview", "conversation"] },
            },
          ],
        },
      };

      const cloned = deepClone(preset);

      expect(cloned).toEqual(preset);
      expect(cloned).not.toBe(preset);
      expect(cloned.config).not.toBe(preset.config);
    });

    it("clones McpServerConfig-like objects", () => {
      const config = {
        command: "node",
        args: ["server.js"],
        env: {
          NODE_ENV: "production",
          API_KEY: "secret",
        },
        metadata: {
          version: "1.0.0",
          capabilities: ["search", "index"],
        },
      };

      const cloned = deepClone(config);

      expect(cloned).toEqual(config);
      expect(cloned).not.toBe(config);
      expect(cloned.env).not.toBe(config.env);
      expect(cloned.metadata).not.toBe(config.metadata);
    });
  });
});
