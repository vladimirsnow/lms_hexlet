import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Minimatch, match, minimatch } from "minimatch";
import { Linter } from "eslint";
import importPlugin from "eslint-plugin-import";
import reactPlugin from "eslint-plugin-react";
import { parse } from "espree";

const require = createRequire(import.meta.url);
const minimatchCjs = require("minimatch");

assert.equal(typeof minimatchCjs.minimatch, "function");
assert.equal(minimatch("src/app/page.tsx", "src/**/*.tsx"), true);
assert.equal(new Minimatch("src/*.tsx").match("src/page.tsx"), true);
assert.deepEqual(match(["page.tsx", "page.js"], "*.tsx"), ["page.tsx"]);

const linter = new Linter();
const importMessages = linter.verify(
  "import value from 'pkg/internal';",
  [
    {
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      plugins: { import: importPlugin },
      rules: {
        "import/no-internal-modules": ["error", { allow: ["pkg/*"] }],
      },
    },
  ],
  { filename: "compat-probe.js" },
);
assert.equal(
  importMessages.some((message) => message.ruleId === "import/no-internal-modules"),
  false,
);

const jsxAst = parse(
  "const view = <Wrapper><Action /></Wrapper>; const control = <SpecialButton />;",
  {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
);

function findElement(node, name) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "JSXElement" && node.openingElement?.name?.name === name) {
    return node;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findElement(item, name);
        if (found) return found;
      }
    } else {
      const found = findElement(value, name);
      if (found) return found;
    }
  }
  return null;
}

const mayContainChildComponent = require("eslint-plugin-jsx-a11y/lib/util/mayContainChildComponent");
const mayHaveAccessibleLabel = require("eslint-plugin-jsx-a11y/lib/util/mayHaveAccessibleLabel");
assert.equal(mayContainChildComponent(findElement(jsxAst, "Wrapper"), "Act*"), true);
assert.equal(
  mayHaveAccessibleLabel(findElement(jsxAst, "SpecialButton"), 1, [], undefined, ["Special*"]),
  false,
);

const reactMessages = linter.verify(
  "const view = <legacyWidget />;",
  [
    {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { react: reactPlugin },
      rules: {
        "react/jsx-pascal-case": ["error", { ignore: ["legacy*"] }],
      },
    },
  ],
  { filename: "compat-probe.jsx" },
);
assert.equal(
  reactMessages.some((message) => message.ruleId === "react/jsx-pascal-case"),
  false,
);

await import(
  new URL("../node_modules/@eslint/eslintrc/lib/config-array/override-tester.js", import.meta.url)
);

process.stdout.write(
  "minimatch named API and ESLint import, JSX-a11y, React, and eslintrc probes passed.\n",
);
