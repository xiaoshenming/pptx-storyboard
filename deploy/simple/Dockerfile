FROM oven/bun:1.3 AS build
WORKDIR /app
ENV HUSKY=0
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter pptx-react-demo build

FROM oven/bun:1.3
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg fonts-noto-cjk python3 python3-venv && \
    python3 -m venv /opt/edge-tts && \
    /opt/edge-tts/bin/pip install --no-cache-dir edge-tts && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
COPY deploy/simple/start.sh /usr/local/bin/storyboard-start
RUN chmod +x /usr/local/bin/storyboard-start && mkdir -p /data/tmp
ENV TMPDIR=/data/tmp
EXPOSE 4173
CMD ["/usr/local/bin/storyboard-start"]
