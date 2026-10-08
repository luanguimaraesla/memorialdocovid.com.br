.DEFAULT_GOAL := help

node_modules: package.json
	npm install
	@touch node_modules

.PHONY: install
install: ## Instala as dependências
	npm install

.PHONY: dev
dev: node_modules ## Sobe o servidor de desenvolvimento
	npm run dev

.PHONY: build
build: node_modules ## Gera o site estático em dist/
	npm run build

.PHONY: preview
preview: node_modules ## Serve o build de produção localmente
	npm run preview

.PHONY: check
check: node_modules ## Roda a verificação de tipos (astro check)
	npm run check

.PHONY: clean
clean: ## Remove artefatos de build
	rm -rf dist .astro

.PHONY: distclean
distclean: clean ## Remove build e dependências
	rm -rf node_modules

.PHONY: help
help: ## Lista os alvos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
