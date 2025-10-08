FROM node:20-alpine
WORKDIR /app
COPY ../../package.json ../../pnpm-workspace.yaml ./
COPY ../../pnpm-lock.yaml ./
COPY ../../services/common/package.json ./services/common/package.json
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build
EXPOSE 4002
CMD ["pnpm","start"]
