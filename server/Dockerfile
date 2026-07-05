# The game server: one Bun process, TypeScript run natively (no build step).
# Pinned to the same Bun as CI — worldgen digests are engine-portable since
# worldgen v11, so the pin is plain reproducibility, not load-bearing.
FROM oven/bun:1.3.12

WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY lib ./lib
COPY db ./db
COPY server ./server

ENV PORT=8080
EXPOSE 8080
CMD ["bun", "server/index.ts"]
