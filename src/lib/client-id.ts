type ClientCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>;

export function createClientId(source: ClientCrypto | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') {
    return source.randomUUID();
  }

  if (typeof source?.getRandomValues === 'function') {
    return createUuidFromRandomValues(source);
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function installClientIdCompatibility(): void {
  const source = globalThis.crypto;
  if (!source || typeof source.randomUUID === 'function' || typeof source.getRandomValues !== 'function') {
    return;
  }
  try {
    Object.defineProperty(source, 'randomUUID', {
      configurable: true,
      value: () => createUuidFromRandomValues(source),
    });
  } catch {
    // Shared conversation code uses createClientId directly if the host object is not extensible.
  }
}

function createUuidFromRandomValues(source: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
