export const DEFAULT_RUNTIME_FLAVOR = 'rust';
export const RUNTIME_ENV_NAME = 'CODEM_RUNTIME_MODE';

const FLAVOR_TO_MODE = new Map([
  ['rust', 'rust'],
]);

const SUPPORTED_RUNTIME_FLAVORS = [...FLAVOR_TO_MODE.keys()];

export const DEFAULT_RUNTIME_MODE = FLAVOR_TO_MODE.get(DEFAULT_RUNTIME_FLAVOR);

function createUnsupportedRuntimeFlavorError(value) {
  return new Error(
    `Unsupported runtime flavor: ${String(value)}. Supported flavors: ${SUPPORTED_RUNTIME_FLAVORS.join(', ')}`,
  );
}

export function normalizeRuntimeFlavor(value) {
  const flavor = value ?? DEFAULT_RUNTIME_FLAVOR;
  if (!FLAVOR_TO_MODE.has(flavor)) {
    throw createUnsupportedRuntimeFlavorError(value);
  }
  return flavor;
}

export function flavorToMode(flavor) {
  return FLAVOR_TO_MODE.get(normalizeRuntimeFlavor(flavor));
}

export function flavorSuffix(flavor) {
  return normalizeRuntimeFlavor(flavor);
}
