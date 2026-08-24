FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY requirements.txt .
# --only-binary :all: turns a missing manylinux cp314 wheel into a clear build
# failure instead of a silent, very slow source build.
RUN pip install --no-cache-dir --only-binary :all: -r requirements.txt

COPY . .
RUN useradd -m -u 10001 app && chown -R app:app /app
USER app

EXPOSE 8000
# --proxy-headers is not optional: without it every audit row records the proxy's
# IP and the rate limiter collapses into a single global bucket.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*", "--no-access-log"]
