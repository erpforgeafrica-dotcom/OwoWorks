# OwoWorks web - minimal runtime image.
# Only the static site and the config-injecting server are copied in; no npm
# install is needed because the server uses Node built-ins only. Runtime config
# comes from environment variables (see railway.json / service variables).
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY apps/web ./apps/web
COPY server.mjs ./server.mjs

USER node
EXPOSE 8080

CMD ["node", "server.mjs"]
