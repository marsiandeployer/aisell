function parseCliArgs(argv, options = {}) {
  const startIndexRaw = Number(options.startIndex);
  const startIndex = Number.isFinite(startIndexRaw) ? Math.max(0, Math.floor(startIndexRaw)) : 2;
  const out = {};

  for (let i = startIndex; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key || !key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : 'true';
    out[name] = value;
    if (value !== 'true') {
      i += 1;
    }
  }

  return out;
}

module.exports = {
  parseCliArgs,
};
