import path from "node:path";
import { defineConfig } from "vitest/config";

const repoProto = path.resolve(__dirname, "../../proto");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      PROTO_ROOT: repoProto,
    },
  },
});
