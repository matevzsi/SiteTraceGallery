FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SITETRACE_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./
COPY app ./app
COPY static ./static
COPY templates ./templates

RUN mkdir -p /data/photos /data/floorplans /data/thumbnails

# Runtime data lives outside the image. Mount a host photo directory at
# /data/photos and persist /data/sitetrace.db, floorplans and thumbnails too.
VOLUME ["/data"]

EXPOSE 5000

CMD ["gunicorn", "--bind=0.0.0.0:5000", "--workers=1", "--threads=4", "--timeout=120", "app:app"]
