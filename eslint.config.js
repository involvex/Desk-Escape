import expo from "eslint-config-expo/flat.js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";

export default [
  ...expo,
  eslintConfigPrettier,
  {
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },
  {
    ignores: ["node_modules/", ".expo/", "dist/", "babel.config.js"],
  },
];
