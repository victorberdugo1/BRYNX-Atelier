# Makefile - build WASM (emscripten + raylib) for the VFX Lab renderer.
# Adapted from the chess_viewer reference build; same emsdk/raylib/ffmpeg
# bootstrap, different source list and JS export surface.

EMSDK_DIR  ?= emsdk
EMSDK_ENV  := $(EMSDK_DIR)/emsdk_env.sh
EMSDK_EMCC := $(EMSDK_DIR)/upstream/emscripten/emcc

RAYLIB_SRC      ?= raylib/src
RAYLIB_REPO_DIR := $(patsubst %/src,%,$(RAYLIB_SRC))
RAYLIB_LIB_SRC  := $(RAYLIB_SRC)/libraylib.web.a
RAYLIB_LIB      := libraylib.a
RAYLIB_CONFIG   := $(RAYLIB_SRC)/config.h

# === FFmpeg.wasm Configuration ===
FFMPEG_VERSION        := 0.12.10
FFMPEG_DIR            := ffmpeg
FFMPEG_WRAPPER_FILES  := ffmpeg.min.js ffmpeg.js
FFMPEG_CORE_FILES     := ffmpeg-core.js ffmpeg-core.wasm
FFMPEG_FILES          := $(FFMPEG_WRAPPER_FILES) $(FFMPEG_CORE_FILES)
FFMPEG_TARGETS        := $(addprefix $(FFMPEG_DIR)/,$(FFMPEG_FILES))
FFMPEG_WRAPPER_URL    := https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@$(FFMPEG_VERSION)/dist/umd
FFMPEG_CORE_URL       := https://cdn.jsdelivr.net/npm/@ffmpeg/core@$(FFMPEG_VERSION)/dist/umd

# === Compilation ===
EMCC := emcc

TARGET   := index
OUT_HTML := $(TARGET).html
OUT_JS   := $(TARGET).js
OUT_WASM := $(TARGET).wasm
OUT_DATA := $(TARGET).data
OUTPUTS  := $(OUT_HTML) $(OUT_JS) $(OUT_WASM) $(OUT_DATA)

SRC := main.c json_mini.c effects/ascii_effect.c effects/particles_effect.c effects/crt_effect.c
ASSETS_DIR := assets
SHELL_FILE := shell.html
VIDEO_EXPORT := video_export.js

# Functions/runtime methods React's wasmBridge.ts calls via Module.ccall(...)
EXPORTED_FUNCS    := ['_js_set_effect_json','_js_get_stats_json','_js_start_export','_js_stop_export','_main']
EXPORTED_RUNTIME  := ['ccall','cwrap']

DEST ?= ../public/wasm

CFLAGS  := -Os -Wall -DPLATFORM_WEB -I. -I$(RAYLIB_SRC)
LDFLAGS := ./$(RAYLIB_LIB) \
           -s USE_GLFW=3 \
           -s GL_ENABLE_GET_PROC_ADDRESS=1 \
           -s ASYNCIFY \
           -s TOTAL_MEMORY=67108864 \
           -s FORCE_FILESYSTEM=1 \
           -s EXPORTED_FUNCTIONS="$(EXPORTED_FUNCS)" \
           -s EXPORTED_RUNTIME_METHODS="$(EXPORTED_RUNTIME)" \
           --preload-file $(ASSETS_DIR) \
           --shell-file $(SHELL_FILE)

# === Utility Functions ===
define WITH_EMSDK
bash -c 'source "$(EMSDK_ENV)" >/dev/null 2>&1 && $(1)'
endef

# === Commands ===
CLONE_EMSDK   = test -d "$(EMSDK_DIR)" || git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$(EMSDK_DIR)"
INSTALL_EMSDK = test -x "$(EMSDK_EMCC)" || (cd "$(EMSDK_DIR)" && ./emsdk install latest && ./emsdk activate latest)
CLONE_RAYLIB  = test -d "$(RAYLIB_SRC)" || git clone --depth 1 https://github.com/raysan5/raylib.git "$(RAYLIB_REPO_DIR)"
COPY_RAYLIB   = cp -f "$(RAYLIB_LIB_SRC)" "./$(RAYLIB_LIB)"

RM_OUT        = rm -f $(OUTPUTS)
RM_LIB        = rm -f "./$(RAYLIB_LIB)"
RM_RAYLIB_DIR = rm -rf "$(RAYLIB_REPO_DIR)"
RM_EMSDK_DIR  = rm -rf "$(EMSDK_DIR)"
RM_FFMPEG_DIR = rm -rf "$(FFMPEG_DIR)"

.PHONY: all emsdk raylib ffmpeg run copy clean fclean emsdk-clean ffmpeg-clean help

help:
	@echo ""
	@echo "Procedural VFX Lab - native renderer Makefile"
	@echo "=============================================="
	@echo ""
	@echo "  make all          - Build everything (emsdk, raylib, ffmpeg, renderer)"
	@echo "  make run          - Build and serve on http://localhost:8000"
	@echo "  make copy         - Copy build output into ../public/wasm (or DEST)"
	@echo ""
	@echo "  make emsdk        - Install emscripten"
	@echo "  make raylib       - Build raylib for PLATFORM_WEB"
	@echo "  make ffmpeg       - Fetch precompiled FFmpeg.wasm"
	@echo ""
	@echo "  make clean        - Remove build outputs"
	@echo "  make fclean       - clean + remove raylib (keeps emsdk)"
	@echo ""

all: $(OUT_HTML)

# ============================================================
# EMSCRIPTEN SDK
# ============================================================

emsdk:
	@echo "[emsdk] Cloning if needed..."
	@$(CLONE_EMSDK)
	@echo "[emsdk] Installing if needed..."
	@$(INSTALL_EMSDK)
	@echo "OK emsdk ready in $(EMSDK_DIR)"

# ============================================================
# RAYLIB
# ============================================================

raylib: emsdk
	@echo "[raylib] Cloning if needed..."
	@$(CLONE_RAYLIB)
	@echo "[raylib] Building libraylib.a for PLATFORM_WEB..."
	@test -f "$(RAYLIB_LIB_SRC)" || $(call WITH_EMSDK,emmake $(MAKE) -C "$(RAYLIB_SRC)" PLATFORM=PLATFORM_WEB -j4)
	@$(COPY_RAYLIB)
	@echo "OK libraylib.a ready (PLATFORM_WEB)"

# ============================================================
# FFMPEG.WASM
# ============================================================

define DOWNLOAD_WRAPPER
	@echo "  downloading $(1) (wrapper)..." && \
	mkdir -p $(FFMPEG_DIR) && \
	curl -fsSL "$(FFMPEG_WRAPPER_URL)/$(1)" -o "$(FFMPEG_DIR)/$(1)" || \
	(echo "  fallback to GitHub release..." && \
	curl -fsSL "https://github.com/ffmpegwasm/ffmpeg.wasm/releases/download/v$(FFMPEG_VERSION)/$(1)" -o "$(FFMPEG_DIR)/$(1)")
endef

define DOWNLOAD_CORE
	@echo "  downloading $(1) (core)..." && \
	mkdir -p $(FFMPEG_DIR) && \
	curl -fsSL "$(FFMPEG_CORE_URL)/$(1)" -o "$(FFMPEG_DIR)/$(1)" || \
	(echo "  fallback to GitHub release..." && \
	curl -fsSL "https://github.com/ffmpegwasm/ffmpeg.wasm/releases/download/v$(FFMPEG_VERSION)/$(1)" -o "$(FFMPEG_DIR)/$(1)")
endef

$(FFMPEG_DIR)/ffmpeg.min.js:
	$(call DOWNLOAD_WRAPPER,ffmpeg.min.js)

$(FFMPEG_DIR)/ffmpeg.js:
	$(call DOWNLOAD_WRAPPER,ffmpeg.js)

$(FFMPEG_DIR)/ffmpeg-core.js:
	$(call DOWNLOAD_CORE,ffmpeg-core.js)

$(FFMPEG_DIR)/ffmpeg-core.wasm:
	$(call DOWNLOAD_CORE,ffmpeg-core.wasm)

ffmpeg: $(FFMPEG_TARGETS)
	@echo "OK FFmpeg.wasm v$(FFMPEG_VERSION) ready in $(FFMPEG_DIR)/"

# ============================================================
# RENDERER COMPILATION
# ============================================================

check: raylib ffmpeg

$(OUT_HTML): check $(SRC) json_mini.h effects/effect_common.h $(SHELL_FILE)
	@echo "[build] Compiling VFX Lab renderer..."
	$(call WITH_EMSDK,$(EMCC) $(SRC) -o $(OUT_HTML) $(CFLAGS) $(LDFLAGS))
	@echo "OK build complete."
	@echo "Next: make run, or make copy to publish into ../public/wasm"

# ============================================================
# RUN & DEPLOY
# ============================================================

run: all
	@echo "Serving on http://localhost:8000"
	python3 -m http.server 8000

copy: all
	@echo "[copy] Copying build output to $(DEST)..."
	@mkdir -p "$(DEST)"
	@cp $(OUT_HTML) $(OUT_JS) $(OUT_WASM) $(VIDEO_EXPORT) "$(DEST)/" 2>/dev/null || true
	@if [ -f $(OUT_DATA) ]; then cp $(OUT_DATA) "$(DEST)/"; fi
	@cp -f $(OUT_JS) "$(DEST)/index.js" 2>/dev/null || true
	@echo "OK copied. wasmBridge.ts probes $(DEST)/index.js"

# ============================================================
# CLEANUP
# ============================================================

clean:
	$(RM_OUT)

fclean: clean
	$(RM_LIB)
	$(RM_RAYLIB_DIR)

ffmpeg-clean:
	$(RM_FFMPEG_DIR)

emsdk-clean:
	$(RM_EMSDK_DIR)

.DEFAULT_GOAL := help
