FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 gdal-bin python3-gdal pdal assimp-utils nodejs npm ca-certificates curl file ffmpeg poppler-utils imagemagick \
    && npm install -g @gltf-transform/cli \
    && rm -rf /var/lib/apt/lists/* /root/.npm
WORKDIR /app
COPY server.py /app/server.py
EXPOSE 4000
USER 10001
CMD ["python3", "/app/server.py"]
