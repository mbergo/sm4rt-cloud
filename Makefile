# Floci Cloud — control plane for on-demand Floci instances on AKS.
#
# Run `make` for the target list.

ACR ?= aiready
REGISTRY ?= $(ACR).azurecr.io
IMAGE ?= $(REGISTRY)/floci-cloud
TAG ?= v1
NAMESPACE ?= floci-cloud
DASHBOARD_HOST ?= cloud.sm4rt.works

.DEFAULT_GOAL := help

.PHONY: help install dev-api dev-ui build image push secrets deploy rollout url token logs destroy

help: ## List available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies for api and ui
	cd api && npm install
	cd ui && npm install

dev-api: ## Run the API locally (uses your kubeconfig)
	cd api && npm run dev

dev-ui: ## Run the UI dev server (proxies /api to :8080)
	cd ui && npm run dev

build: ## Build the UI production bundle
	cd ui && npm run build

image: ## Build the combined Docker image
	docker build -t $(IMAGE):$(TAG) .

push: ## Push the image to ACR
	az acr login --name $(ACR)
	docker push $(IMAGE):$(TAG)

secrets: ## Ensure namespace, auth token and ACR pull secret exist
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	@kubectl -n $(NAMESPACE) get secret floci-cloud-auth >/dev/null 2>&1 || \
		kubectl -n $(NAMESPACE) create secret generic floci-cloud-auth \
			--from-literal=token=$$(openssl rand -hex 24)
	@kubectl -n $(NAMESPACE) get secret acr-pull >/dev/null 2>&1 || \
		kubectl -n $(NAMESPACE) create secret docker-registry acr-pull \
			--docker-server=$(REGISTRY) \
			--docker-username=$$(az acr credential show -n $(ACR) --query username -o tsv) \
			--docker-password=$$(az acr credential show -n $(ACR) --query 'passwords[0].value' -o tsv)

deploy: secrets ## Apply manifests and wait for rollout
	kubectl apply -f deploy/floci-cloud.yaml
	kubectl -n $(NAMESPACE) rollout status deploy/floci-cloud --timeout=180s

rollout: ## Restart the deployment (after pushing a new image)
	kubectl -n $(NAMESPACE) rollout restart deploy/floci-cloud
	kubectl -n $(NAMESPACE) rollout status deploy/floci-cloud --timeout=180s

url: ## Print the dashboard URL
	@echo "https://$(DASHBOARD_HOST)"

token: ## Print the dashboard access token
	@kubectl -n $(NAMESPACE) get secret floci-cloud-auth -o jsonpath='{.data.token}' | base64 -d; echo

logs: ## Tail control-plane logs
	kubectl -n $(NAMESPACE) logs -f deploy/floci-cloud

destroy: ## Remove the control plane (instances survive; delete floci-i-* namespaces manually)
	kubectl delete -f deploy/floci-cloud.yaml --ignore-not-found
