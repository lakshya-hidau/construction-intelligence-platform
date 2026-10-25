# Developer shortcuts. Run `make help` for the list.
.PHONY: help install install-backend install-frontend dev backend frontend build test lint clean

PY := python3
PIP := $(PY) -m pip

help:
	@echo "Multimodal Construction Intelligence Platform"
	@echo ""
	@echo "  make install        Install backend + frontend dependencies"
	@echo "  make backend        Run the API on :8000 (reload)"
	@echo "  make frontend       Run the Vite dev server on :5173"
	@echo "  make dev            Run both (API in background, then frontend)"
	@echo "  make build          Build the production SPA into frontend/dist"
	@echo "  make test           Run the backend test suite"
	@echo "  make lint           Ruff check the backend"
	@echo "  make clean          Remove build artifacts and caches"

install: install-backend install-frontend

install-backend:
	cd backend && $(PIP) install -r requirements-dev.txt

install-frontend:
	cd frontend && npm install

backend:
	cd backend && $(PY) -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "Starting API (background) + frontend..."
	@(cd backend && $(PY) -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &) ; \
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test:
	cd backend && $(PY) -m pytest tests -q

lint:
	cd backend && $(PY) -m ruff check . --select F,E9

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf backend/.pytest_cache backend/.ruff_cache frontend/dist frontend/node_modules/.vite
	@echo "cleaned"
