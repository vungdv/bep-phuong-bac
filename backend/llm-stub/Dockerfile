FROM node:22-alpine
WORKDIR /app
COPY server.cjs replies.json ./
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=3s --retries=20 CMD wget -q -O /dev/null http://localhost:8080/health || exit 1
USER node
CMD ["node", "server.cjs"]
