import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "truce-rack-feasibility/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/essential"],
  {
    files: ["**/*.{js,mjs,cjs,ts,vue}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-mutating-props": "off",
    },
  },
  {
    files: ["src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          "selector": "ImportDeclaration[source.value='@tauri-apps/api/core'] > ImportSpecifier[imported.name='invoke']",
          "message": "Use tauriInvoke from services/tauri/invoke instead of raw invoke from @tauri-apps/api/core."
        }
      ]
    }
  },
  {
    // invoke.ts 封装层和 pluginApi.ts mock 占位需要原始 invoke
    files: ["src/services/tauri/invoke.ts", "src/services/tauri/pluginApi.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["**/*.{ts,vue}"],
    rules: {
      "no-undef": "off",
    },
  },
);