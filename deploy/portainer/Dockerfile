FROM node:24-bookworm-slim AS build
WORKDIR /app
# Upload this archive through Portainer's Web editor "Select files" control.
# ADD extracts the archive into the build directory, including package*.json.
ADD zeitklar-source.tar.gz ./
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data BODY_SIZE_LIMIT=110M
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "build"]
