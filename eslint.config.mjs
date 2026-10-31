import nextConfig from "eslint-config-next";
import eslintConfigPrettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextConfig,
  eslintConfigPrettier,
  {
    // Match Next's TypeScript plugin registration for the typed rule overrides.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Relaxed rules for open-source friendliness
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    rules: {
      // Allow console for server-side logging
      "no-console": "off",
    },
  },
];

export default eslintConfig;
