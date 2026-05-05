# Use Chainguard Node image for development
FROM cgr.dev/chainguard/node:latest-dev

WORKDIR /app

# Copy package files (package.json + package-lock.json)
COPY --chown=node:node package*.json ./

# Install exact locked deps. `npm ci` requires package-lock.json and fails
# loudly if it's out of sync with package.json.
RUN npm ci

# Copy source files
COPY --chown=node:node . .

# Expose dev server port
EXPOSE 5173

# Reset entrypoint (Chainguard image sets node as entrypoint)
ENTRYPOINT []

# Run dev server with hot reload
CMD ["/bin/sh", "-c", "npm run dev -- --host 0.0.0.0"]
