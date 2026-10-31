.PHONY: build test demo docker-local linux clean

BIN := stateshift

build:
	go build -o $(BIN) ./cmd/stateshift

test:
	go vet ./...
	go test ./... -count=1

# single machine, two nodes, no external services
demo:
	go run ./cmd/stateshift --role=all --db=mem --blob=fs --blob-dir=.run/blob --llm=mock

# build the Linux binary for the droplets from Windows
linux:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o stateshift-linux ./cmd/stateshift

clean:
	rm -rf $(BIN) stateshift-linux bin .run
