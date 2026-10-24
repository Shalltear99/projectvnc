# CloudJava VNC — common operations
.PHONY: help install build test worker stack up down logs janitor clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## install backend + frontend dependencies
	cd backend && npm install
	cd frontend && npm install

build: ## compile backend and build the Next.js dashboard
	cd backend && npm run build
	cd frontend && npm run build

test: ## run the TC-01 container lifecycle integration test
	cd backend && node scripts/integration-test.mjs

worker: ## build the worker node image
	docker build -t cloudjava-worker:latest ./worker-node

stack: ## start postgres, redis, api, dashboard, nginx
	cd ops && docker compose up -d --build

up: stack ## alias for stack

down: ## stop the stack (worker containers survive)
	cd ops && docker compose down

logs: ## tail the control-plane logs
	cd ops && docker compose logs -f --tail=100 api

janitor: ## run one janitor sweep manually
	cd backend && node agent-daemon.js --once

clean: ## remove build artifacts (not node_modules)
	rm -rf backend/dist frontend/.next
