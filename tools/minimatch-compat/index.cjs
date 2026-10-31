const engine = require("minimatch-engine");

/** Internal lint consumers retain callable and named imports of the fixed engine. */
module.exports = Object.assign(engine.minimatch, engine, {
  makeRe(pattern, options) {
    // eslint-plugin-import consumes only .test(); v11 uses non-RegExp matchers.
    const matcher = new engine.Minimatch(pattern, options);
    return { test: (value) => matcher.match(value) };
  },
});
