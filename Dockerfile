# syntax=docker/dockerfile:1
# Float Sim in a container: the page, plus "Solve with Capytaine" (tools/serve.py + Capytaine).
#   docker compose up            → http://localhost:8765
#   docker compose run --rm test → Node + Python test suites (see docker-compose.yml)

# ---- app: Python 3.14 + Capytaine, serving the page and the solver API
FROM python:3.14-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt && rm /tmp/requirements.txt
RUN useradd --create-home --uid 1000 floatsim
WORKDIR /app
COPY --chown=floatsim . .
USER floatsim
EXPOSE 8765
# Bind to all interfaces inside the container; docker-compose.yml publishes the port on 127.0.0.1 only,
# and serve.py still refuses API requests whose Host is not localhost.
CMD ["python", "tools/serve.py", "--bind", "0.0.0.0", "--port", "8765"]

# ---- test: the app image plus Node 22 for the JS validation suites
FROM app AS test
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
ENV FLOATSIM_PYTHON=python
CMD ["node", "test/validate-node.mjs"]
