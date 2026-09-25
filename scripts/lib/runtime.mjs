export const MINIMUM_NODE_MAJOR = 22;

export function nodeMajor(version) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  return Number.isInteger(major) ? major : null;
}

export function assertSupportedNode(version = process.versions.node) {
  const major = nodeMajor(version);
  if (major === null || major < MINIMUM_NODE_MAJOR) {
    throw new Error(
      `Charthouse requires Node.js ${MINIMUM_NODE_MAJOR} or newer; found ${version}. `
      + 'Install a supported Node.js LTS release and try again.'
    );
  }
}
