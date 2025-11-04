# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# copy requirements from monorepo path
COPY services/python-ai-service/requirements.txt /tmp/requirements.txt

# install build deps for any wheels that need compiling; keep image small
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl \
 && rm -rf /var/lib/apt/lists/* \
 && python -m pip install --upgrade pip \
 && pip install --no-cache-dir -r /tmp/requirements.txt

# copy the app from monorepo path
COPY services/python-ai-service/app /app/app

EXPOSE 5005
CMD ["gunicorn", "-c", "app/gunicorn.conf.py", "app.ai_main:app"]