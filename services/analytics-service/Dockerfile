FROM node:20-alpine
WORKDIR /app
COPY ../../package.json ../../pnpm-workspace.yaml ./
COPY ../../services/common/package.json ./services/common/package.json
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 4004
CMD ["pnpm","start"]
