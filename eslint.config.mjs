import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      // Session workspace, gitignored. CI never sees it, so linting it locally
      // only makes the two signals disagree.
      "scratchpad/**",
      "next-env.d.ts"
    ]
  }
];

export default eslintConfig;
