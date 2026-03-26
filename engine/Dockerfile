FROM python:3.12-slim

WORKDIR /app

# Copy dependency files first for layer caching.
# Subsequent deploys that only change code skip the install layer.
COPY pyproject.toml .
COPY engine/ engine/

RUN pip install --no-cache-dir .

COPY . .

# MUST use shell form so $PORT expands at runtime.
# railway.toml startCommand does NOT expand shell variables — never add it there.
CMD uvicorn engine.main:app --host 0.0.0.0 --port $PORT
