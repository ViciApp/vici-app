# VICI backend image for Fly.io. Bun runs the TypeScript entrypoint directly,
# so there is no build/transpile step. See fly.toml.
# The Bun version is pinned once, in .bun-version next to this file; the deploy
# passes it in. With no value the FROM below does not resolve, so a build that
# forgets it fails instead of picking a version. CI runs the same image, named
# in .github/workflows/backend-bun-image.yml: change the variant in both.
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-alpine

WORKDIR /app

# Install deps first for layer caching. --frozen-lockfile fails if bun.lock is
# stale; --production skips devDependencies (typescript/@types) not needed at run.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production
EXPOSE 8787

CMD ["bun", "run", "src/index.ts"]
