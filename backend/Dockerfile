# Pinned to bookworm: `python:3.12-slim` floats to trixie, which Playwright's --with-deps can't resolve
FROM python:3.12-slim-bookworm

WORKDIR /app

# asyncpg toolchain + fonts the report PDFs render with; Chromium's own OS libs come from `playwright install --with-deps`
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install --with-deps chromium

COPY . .

RUN mkdir -p /app/uploads

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8721

ENTRYPOINT ["/entrypoint.sh"]
