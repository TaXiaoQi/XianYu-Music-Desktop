import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".codex/**",
      "dist/**",
      "MD/**",
      "node_modules/**",
      "src-tauri/**",
      "tag_test/**",
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
      "no-restricted-imports": ["error", {
        "paths": [
          {
            "name": "./composables/playerService",
            "message": "Import app/player capabilities from src/composables/playerCore or feature domains instead of the legacy playerService facade."
          },
          {
            "name": "../composables/playerService",
            "message": "Import app/player capabilities from src/composables/playerCore or feature domains instead of the legacy playerService facade."
          },
          {
            "name": "../../composables/playerService",
            "message": "Import app/player capabilities from src/composables/playerCore or feature domains instead of the legacy playerService facade."
          },
          {
            "name": "./stores/library",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/playback",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/collections",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/settings",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/navigation",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/ui",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./stores/statistics",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/library",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/playback",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/collections",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/settings",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/navigation",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/ui",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../stores/statistics",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/library",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/playback",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/collections",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/settings",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/navigation",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/ui",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../stores/statistics",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/library",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/playback",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/collections",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/settings",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/navigation",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/ui",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "../../../stores/statistics",
            "message": "Import stores from features/*/store or shared/stores/* instead of the legacy src/stores entrypoints."
          },
          {
            "name": "./composables/settings",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useCollectionsActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useLibraryBrowse",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useLibraryCollections",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useLibraryRuntimeActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useLibrarySync",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/usePlaybackActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/usePlaybackController",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/usePlayerLibraryView",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "./composables/useSongTableLibraryState",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/settings",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useCollectionsActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useLibraryBrowse",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useLibraryCollections",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useLibraryRuntimeActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useLibrarySync",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/usePlaybackActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/usePlaybackController",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/usePlayerLibraryView",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../composables/useSongTableLibraryState",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/settings",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useCollectionsActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useLibraryBrowse",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useLibraryCollections",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useLibraryRuntimeActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useLibrarySync",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/usePlaybackActions",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/usePlaybackController",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/usePlayerLibraryView",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          },
          {
            "name": "../../composables/useSongTableLibraryState",
            "message": "Import feature APIs from src/features/* directly. The matching src/composables wrapper is compatibility-only."
          }
        ]
      }]
    }
  },
  {
    files: ["**/*.{ts,vue}"],
    rules: {
      "no-undef": "off",
    },
  },
);
