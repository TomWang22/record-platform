import { createApp } from "./app.js";

const app = createApp();
const port = Number(process.env.GATEWAY_PORT || 4000);

app.listen(port, () => console.log(`gateway up on :${port}`));
