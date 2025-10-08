FROM node:20-alpine
WORKDIR /app
COPY ../../package.json ../../pnpm-workspace.yaml ./
COPY ../../pnpm-lock.yaml ./
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
CMD ["pnpm","start"]
