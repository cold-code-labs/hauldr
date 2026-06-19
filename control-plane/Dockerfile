# Build context = repo root (needs migrations/ and control/).
FROM node:22-alpine
RUN npm i -g pnpm@9
WORKDIR /app/control-plane
COPY control-plane/package.json control-plane/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY control-plane ./
COPY migrations /app/migrations
COPY control /app/control
EXPOSE 8787
CMD ["sh", "-c", "pnpm bootstrap && pnpm start"]
