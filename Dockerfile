FROM node:24.21.0-bookworm-slim
WORKDIR /repro
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig.json server.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
CMD ["npm", "run", "validate"]
