FROM node:18-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV PORT=3001
ENV NODE_ENV=production
ENV DB_PATH=/app/data/form_collector.db
ENV JWT_SECRET=5eae4cd8eaf249155b7194cf9f842dab4a071a8810cbc16844079a1b6bfdf8c9

EXPOSE 3001

CMD ["node", "server.js"]
