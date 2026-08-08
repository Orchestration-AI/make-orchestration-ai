BINARY=terraform-provider-orchestration-ai
INSTALL_DIR=$(HOME)/.terraform.d/plugins/registry.terraform.io/orchestration-ai/orchestration-ai/0.0.1/$(shell go env GOOS)_$(shell go env GOARCH)

.PHONY: build install test testacc

build:
	go build -o $(BINARY) .

install: build
	mkdir -p $(INSTALL_DIR)
	cp $(BINARY) $(INSTALL_DIR)/

test:
	go test ./... -v -count=1

testacc:
	TF_ACC=1 go test ./... -v -count=1 -timeout 30m
