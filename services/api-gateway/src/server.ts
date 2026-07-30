import "./otel-bootstrap.js";
import { createApp } from "./app.js";
import {
  installShutdownSignalHandlers,
  registerShutdownResource,
  setRpBuildInfoMetric,
} from "@common/utils";

installShutdownSignalHandlers({ service: "api-gateway" });
setRpBuildInfoMetric("api-gateway");

const app = createApp();
const port = Number(process.env.GATEWAY_PORT || 4000);

const server = app.listen(port, () => console.log(`gateway up on :${port}`));

registerShutdownResource({
  name: "http-server",
  order: 50,
  close: () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
});
