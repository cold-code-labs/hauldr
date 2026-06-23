# Build context = ./panel
FROM node:22-alpine AS build
RUN npm i -g pnpm@9
WORKDIR /app
# Read-only GitHub Packages token for the private @cold-code-labs/* deps.
# Build-stage only — this stage is discarded; the runtime image carries no token.
ARG NODE_AUTH_TOKEN
COPY package.json pnpm-lock.yaml .npmrc ./
RUN NODE_AUTH_TOKEN="$NODE_AUTH_TOKEN" pnpm install --no-frozen-lockfile
COPY . ./
RUN pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
