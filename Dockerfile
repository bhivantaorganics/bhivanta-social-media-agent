FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY templates ./templates
RUN mkdir -p /app/data
ENV PORT=3000 DB_PATH=/app/data/data.db
EXPOSE 3000
CMD ["node", "server.js"]
