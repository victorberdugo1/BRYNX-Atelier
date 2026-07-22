CYAN := \033[36m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

WASM_BUILDER_IMAGE := vfx-lab-wasm-builder:dev

# Files the Emscripten build must produce and that wasmBridge.ts / the
# browser runtime require at request time. index.data is the one that
# silently goes missing: if it's absent, Vite's dev server SPA fallback
# serves index.html for the /wasm/index.data request instead of a 404,
# and Emscripten happily treats that HTML as the preload blob — which is
# how a "shader" ends up containing '<!doctype html>' and fails to compile.
REQUIRED_WASM_FILES := index.js index.wasm index.data

all: up ## Alias for 'up' (default target)

up: ## Start containers in detached mode
	docker compose up -d

wasm-assets: ## Extract index.js/.wasm/.data + ffmpeg-core.* into public/ for local `npm run dev`
	@mkdir -p public/wasm public/ffmpeg
	@docker build -f Dockerfile --target wasm-builder -t $(WASM_BUILDER_IMAGE) .
	@cid=$$(docker create $(WASM_BUILDER_IMAGE)); \
		docker cp $$cid:/build/public/wasm/. public/wasm/; \
		docker cp $$cid:/build/public/ffmpeg/. public/ffmpeg/; \
		docker rm $$cid >/dev/null
	@missing=0; \
	for f in $(REQUIRED_WASM_FILES); do \
		if [ ! -s public/wasm/$$f ]; then \
			echo "$(RED)MISSING or empty: public/wasm/$$f$(RESET)"; \
			missing=1; \
		fi; \
	done; \
	if [ $$missing -eq 1 ]; then \
		echo "$(RED)wasm-assets FAILED$(RESET) — the wasm-builder image didn't produce every file the runtime needs."; \
		echo "Check that the Dockerfile's wasm-builder stage actually runs 'make copy' in native/,"; \
		echo "and that native/Makefile's LDFLAGS still has --preload-file assets (that's what generates index.data)."; \
		exit 1; \
	fi
	@echo "$(CYAN)OK wasm-assets:$(RESET) $$(ls -la public/wasm/)"

wasm: ## Rebuild frontend (WASM + Vite) and restart detached
	docker compose build frontend && docker compose up -d

wasm-full: ## Rebuild frontend from scratch (no cache) and restart detached
	docker compose build --no-cache frontend && docker compose up -d

down: ## Stop and remove containers (keeps volumes/images)
	docker compose down

re: down ## Rebuild everything and restart
	docker compose build && docker compose up -d

build: ## Build all images without starting containers
	docker compose build

logs: ## Follow logs for all services
	docker compose logs -f

logs-%: ## Follow logs for one service, e.g. make logs-frontend
	docker compose logs -f $*

clean: ## Remove containers + volumes, prune dangling system resources
	docker compose down -v
	docker system prune -a -f

destroy: ## Nuke this project: containers, volumes, images, orphans
	docker compose down --volumes --remove-orphans --rmi all || true
	@if [ -n "$$(docker ps -aq)" ]; then docker stop $$(docker ps -aq); fi
	@if [ -n "$$(docker ps -aq)" ]; then docker rm -f $$(docker ps -aq); fi
	@if [ -n "$$(docker images -aq)" ]; then docker rmi -f $$(docker images -aq); fi
	@if [ -n "$$(docker volume ls -q)" ]; then docker volume rm $$(docker volume ls -q); fi
	docker builder prune -a -f || true
	docker buildx prune -a -f || true
	docker system prune -a --volumes -f || true

delete: destroy ## Alias for destroy

shell-%: ## Open a shell in a running container, e.g. make shell-frontend
	docker compose exec $* sh

help: ## Show this help message
	@echo "$(YELLOW)Available commands:$(RESET)"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_%-]+:.*##/ { printf "  $(CYAN)%-15s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: all up down build logs clean destroy delete re shell-% wasm wasm-full wasm-assets help
