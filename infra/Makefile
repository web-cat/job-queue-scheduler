NAMESPACE := webcat
K8S_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))k8s

.PHONY: deploy destroy status logs-api logs-dispatcher migrate

deploy:
	kubectl apply -f $(K8S_DIR)/namespace.yaml
	kubectl apply -f $(K8S_DIR)/configmap.yaml
	kubectl apply -f $(K8S_DIR)/secret.yaml
	kubectl apply -f $(K8S_DIR)/pv-submissions.yaml
	kubectl apply -f $(K8S_DIR)/postgres-service.yaml
	kubectl apply -f $(K8S_DIR)/postgres-deployment.yaml
	kubectl wait --for=condition=available deployment/postgres -n $(NAMESPACE) --timeout=120s
	kubectl apply -f $(K8S_DIR)/dispatcher-rbac.yaml
	kubectl apply -f $(K8S_DIR)/api-deployment.yaml
	kubectl apply -f $(K8S_DIR)/api-service.yaml
	kubectl apply -f $(K8S_DIR)/dispatcher-deployment.yaml
	kubectl apply -f $(K8S_DIR)/network-policy.yaml
	@echo "Applied manifests. Run migrations: make migrate"
	@echo "API NodePort: 30333 on any cluster node (e.g. http://<node-ip>:30333/api/v1/health)"

destroy:
	kubectl delete namespace $(NAMESPACE) --ignore-not-found

status:
	kubectl get all -n $(NAMESPACE)

logs-api:
	kubectl logs -f deployment/webcat-api -n $(NAMESPACE)

logs-dispatcher:
	kubectl logs -f deployment/webcat-dispatcher -n $(NAMESPACE)

migrate:
	kubectl exec deployment/webcat-api -n $(NAMESPACE) -- node ace migration:run --force
