// Compatibility polyfills for older embedded Chromium runtimes (e.g., VS Code internal browser).

declare global {
  interface Map<K, V> {
    getOrInsert?(key: K, defaultValue: V): V;
    getOrInsertComputed?(key: K, computeValue: (key: K) => V): V;
  }
}

if (!Map.prototype.getOrInsert) {
  Map.prototype.getOrInsert = function <K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
    if (!this.has(key)) {
      this.set(key, defaultValue);
      return defaultValue;
    }
    return this.get(key) as V;
  };
}

if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function <K, V>(
    this: Map<K, V>,
    key: K,
    computeValue: (key: K) => V,
  ): V {
    if (!this.has(key)) {
      const value = computeValue(key);
      this.set(key, value);
      return value;
    }
    return this.get(key) as V;
  };
}

export {};
