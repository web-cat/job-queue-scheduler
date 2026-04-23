# Infrastructure (Kubernetes)

Manifests under `k8s/` deploy the Web-CAT execution service to a single-node cluster (for example k3s on Endeavour).

Create `k8s/secret.yaml` from the example (the real file is gitignored):

```bash
cp k8s/secret.example.yaml k8s/secret.yaml
# edit k8s/secret.yaml, then:
```

From this directory:

```bash
make deploy
```

See [Deployment guide](../docs/DEPLOYMENT.md) for prerequisites, building the image, configuring secrets, verification, updates, rollbacks, and troubleshooting.
