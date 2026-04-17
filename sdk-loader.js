// Plain CJS file — tsx/esbuild won't transform .js requires.
// This ensures the SDK loads via Node's native CJS require,
// preserving its internal import.meta.url resolution for cli.js.
const sdk = require("@anthropic-ai/claude-agent-sdk");
module.exports = sdk;
module.exports.default = sdk;
