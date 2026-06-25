# Build context = repo root (mirrors control-plane/Dockerfile).
FROM node:22-alpine
RUN npm i -g pnpm@9
WORKDIR /app/worker
COPY worker/package.json worker/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY worker ./
CMD ["pnpm", "start"]
