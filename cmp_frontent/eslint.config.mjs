/**
 * ESLint, flat config.
 *
 * `eslint-config-next` 16 ships native flat configs, so it is imported directly.
 * Routing it through `FlatCompat` — as the scaffold does — makes the eslintrc
 * compatibility layer try to JSON-serialise a plugin object containing a cycle,
 * and the whole run dies with "Converting circular structure to JSON" before a
 * single file is linted.
 */
import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "src/types/api-schema.d.ts", // generated from the OpenAPI document
    ],
  },

  ...asArray(next),
  ...asArray(nextCoreWebVitals),
  ...asArray(nextTypescript),

  {
    // `eslint-config-next` already registers the jsx-a11y plugin and its
    // recommended set, so registering it again is a "Cannot redefine plugin"
    // error. Its rules are tightened here instead.
    //
    // Accessibility is not decoration in this product: it is used by people
    // exercising a statutory right, and an unlabelled control is a barrier to it.
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` defeats the point of a typed API client.
      "@typescript-eslint/no-explicit-any": "warn",
      // console.error is how the error boundary reports. The rest is debris.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // next/link renders its own anchor, so the base rule misfires.
      "jsx-a11y/anchor-is-valid": "off",
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either" }],
    },
  },

  /**
   * The dependency rule, enforced rather than remembered.
   *
   * Layers may only call the layer below:
   *
   *     app / components  ->  features  ->  lib  ->  the network
   *
   * A page that imports `@/lib/api` skips two of those. It works, which is
   * exactly the problem: it works until somebody needs to change how requests
   * are made and finds the change is in forty files rather than one. The same
   * goes for a component importing `axios` directly, which would bypass the
   * request id, the credential mode, the CSRF header and the error
   * normalisation all at once.
   *
   * Documented rules get forgotten during a deadline. A lint error does not.
   */
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/api",
              message:
                "Pages and components reach the network through a feature: import from @/features/<domain>, which owns the endpoint. See features/projects/api.ts.",
            },
            {
              name: "@/lib/api/client",
              message: "Same as @/lib/api - go through the feature that owns the endpoint.",
            },
            {
              name: "axios",
              message:
                "Use the shared client in @/lib/api, which attaches the request id, credentials, the CSRF header, and normalises errors into ApiError.",
            },
          ],
        },
      ],
    },
  },

  /**
   * The other direction: nothing in `lib` may depend on a feature or a
   * component. `lib` is the bottom of the stack, and an import pointing upward
   * from it is a cycle waiting to be discovered at build time.
   */
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/components/*", "@/app/*"],
              message:
                "lib is the bottom layer: it may not import from features, components or app. Move the shared piece down into lib, or the dependent piece up.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // A test may reach for whatever it needs to construct the situation.
      "no-restricted-imports": "off",
    },
  },

  // Last: switches off the stylistic rules Prettier already owns, so the two
  // never disagree about the same line.
  prettier,
];

export default config;

/** These packages export either a config object or an array of them. */
function asArray(config) {
  const resolved = config?.default ?? config;
  return Array.isArray(resolved) ? resolved : [resolved];
}
