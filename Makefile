# RealityCheck — developer convenience targets
# Usage: make <target>
# Requires: Node.js 18+, npm 9+

.PHONY: help install build build-core build-chrome build-edge build-firefox build-safari test clean

help:
	@echo ""
	@echo "RealityCheck — available targets:"
	@echo ""
	@echo "  make install          Install all dependencies (run once after cloning)"
	@echo "  make build            Build core library + all four extensions"
	@echo "  make build-core       Build shared core library only"
	@echo "  make build-chrome     Build Chrome extension  → extensions/chrome/dist/"
	@echo "  make build-edge       Build Edge extension    → extensions/edge/dist/"
	@echo "  make build-firefox    Build Firefox extension → extensions/firefox/dist/"
	@echo "  make build-safari     Build Safari extension  → extensions/safari/dist/"
	@echo "  make test             Run all unit tests"
	@echo "  make clean            Remove all dist/ build artefacts"
	@echo ""

install:
	npm install

build: build-core
	node extensions/chrome/build.js
	node extensions/edge/build.js
	node extensions/firefox/build.js
	node extensions/safari/build.js

build-core:
	cd packages/core && npm run build

build-chrome: build-core
	node extensions/chrome/build.js

build-edge: build-core
	node extensions/edge/build.js

build-firefox: build-core
	node extensions/firefox/build.js

build-safari: build-core
	node extensions/safari/build.js

test:
	cd packages/core && npm test

clean:
	rm -rf packages/core/dist
	rm -rf extensions/chrome/dist
	rm -rf extensions/edge/dist
	rm -rf extensions/firefox/dist
	rm -rf extensions/safari/dist
