// Command stateshift runs the StateShift control plane and worker agents.
//
// One binary, three roles:
//
//	--role=api   control plane + dashboard (:9100)
//	--role=node  worker agent            (:9101)
//	--role=all   control plane + two local workers + two worker agents (:9102)
//
// Everything is userspace: no root, no kernel features, no CRIU.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/guneettoppo/stateshift/internal/blob"
	"github.com/guneettoppo/stateshift/internal/coordinator"
	"github.com/guneettoppo/stateshift/internal/model"
	"github.com/guneettoppo/stateshift/internal/node"
	"github.com/guneettoppo/stateshift/internal/store"
	"github.com/guneettoppo/stateshift/internal/workload"
)

func main() {
	var (
		role           = flag.String("role", "all", "api | node | all")
		listen         = flag.String("listen", ":9100", "listen address for this role")
		nodeID         = flag.String("node-id", "", "node identity (default: host-role)")
		coordinatorURL = flag.String("coordinator", "http://127.0.0.1:9100", "control plane URL for a node")
		listenB        = flag.String("listen-b", ":9102", "second worker address for --role=all")
		dbKind         = flag.String("db", "mem", "mem | pg | yugabyte")
		dbURL          = flag.String("db-url", os.Getenv("STATESHIFT_DB_URL"), "YSQL/Postgres DSN")
		blobKind       = flag.String("blob", "fs", "fs | spaces")
		blobDir        = flag.String("blob-dir", ".run/blob", "directory for --blob=fs")
		spacesEndpoint = flag.String("spaces-endpoint", os.Getenv("SPACES_ENDPOINT"), "e.g. https://blr1.digitaloceanspaces.com")
		spacesRegion   = flag.String("spaces-region", envOr("SPACES_REGION", "blr1"), "spaces region")
		spacesBucket   = flag.String("spaces-bucket", os.Getenv("SPACES_BUCKET"), "spaces bucket")
		spacesKey      = flag.String("spaces-key", os.Getenv("SPACES_KEY"), "spaces access key")
		spacesSecret   = flag.String("spaces-secret", os.Getenv("SPACES_SECRET"), "spaces secret key")
		spacesPrefix   = flag.String("spaces-prefix", envOr("SPACES_PREFIX", "stateshift"), "key prefix")
		llmKind        = flag.String("llm", "mock", "mock | gemini")
		geminiKey      = flag.String("gemini-key", os.Getenv("GEMINI_API_KEY"), "Gemini API key")
		geminiModel    = flag.String("gemini-model", envOr("GEMINI_MODEL", "gemini-2.5-flash"), "Gemini model")
		stepDelay      = flag.Duration("step-delay", 25*time.Millisecond, "delay between steps")
		checkpointEach = flag.Int("checkpoint-each", 20, "periodic checkpoint interval in steps")
	)
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	st, err := openStore(ctx, *dbKind, *dbURL)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	b, err := openBlob(*blobKind, *blobDir, *spacesEndpoint, *spacesRegion, *spacesBucket, *spacesKey, *spacesSecret, *spacesPrefix)
	if err != nil {
		log.Fatalf("blob: %v", err)
	}

	var llm workload.LLM = workload.MockLLM{}
	if *llmKind == "gemini" {
		if *geminiKey == "" {
			log.Fatal("--llm=gemini needs --gemini-key or GEMINI_API_KEY")
		}
		llm = &workload.GeminiLLM{Key: *geminiKey, Model: *geminiModel}
	}
	reg := workload.NewRegistry(workload.Compute{}, workload.Agent{Client: llm})

	labels := map[string]string{"db": *dbKind, "blob": b.Name(), "llm": llm.Name()}
	log.Printf("StateShift role=%s db=%s blob=%s llm=%s", *role, *dbKind, b.Name(), llm.Name())

	switch strings.ToLower(*role) {
	case "api":
		c := coordinator.New(st, b, reg, labels)
		go c.Broadcast(ctx)
		serve(ctx, *listen, c.Handler())
	case "node":
		id := *nodeID
		if id == "" {
			id = "node"
		}
		n := node.New(node.Config{
			ID:             id,
			Addr:           advertised(*listen),
			CoordinatorURL: *coordinatorURL,
			StepDelay:      *stepDelay,
			CheckpointEach: *checkpointEach,
		}, st, b, reg)
		go n.Register(ctx)
		serve(ctx, *listen, n.Handler())
	case "all":
		c := coordinator.New(st, b, reg, labels)
		go c.Broadcast(ctx)

		nodes := []struct {
			id, listen, addr string
		}{
			{"A", ":9101", "http://127.0.0.1:9101"},
			{"B", *listenB, "http://127.0.0.1" + *listenB},
		}
		seed := make([]*model.NodeInfo, 0, len(nodes))
		for _, spec := range nodes {
			addr := spec.addr
			n := node.New(node.Config{
				ID:             spec.id,
				Addr:           addr,
				CoordinatorURL: "http://127.0.0.1" + *listen,
				StepDelay:      *stepDelay,
				CheckpointEach: *checkpointEach,
			}, st, b, reg)
			go n.Register(ctx)
			go serveAsync(spec.listen, n.Handler())
			seed = append(seed, &model.NodeInfo{ID: spec.id, Addr: addr, LastSeen: time.Now().UTC()})
		}
		// Give the goroutines a moment, then declare the fleet to the coordinator.
		time.Sleep(120 * time.Millisecond)
		c.SeedNodes(seed...)
		log.Printf("dashboard: http://127.0.0.1%s  (nodes %s, %s)", *listen, seed[0].Addr, seed[1].Addr)
		serve(ctx, *listen, c.Handler())
	default:
		log.Fatalf("unknown role %q", *role)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// advertised turns ":9101" into a dialable URL.
func advertised(listen string) string {
	if strings.HasPrefix(listen, "http://") || strings.HasPrefix(listen, "https://") {
		return listen
	}
	host := "127.0.0.1"
	if strings.Contains(listen, ":") && !strings.HasPrefix(listen, ":") {
		// already host:port
		return "http://" + listen
	}
	port := listen
	return "http://" + host + port
}

func openStore(ctx context.Context, kind, dsn string) (store.Store, error) {
	switch kind {
	case "mem":
		return store.NewMem(), nil
	case "pg", "yugabyte":
		if dsn == "" {
			return nil, fmt.Errorf("--db-url (or STATESHIFT_DB_URL) is required for --db=%s", kind)
		}
		pg, err := store.NewPG(ctx, dsn)
		if err != nil {
			return nil, err
		}
		if err := pg.Migrate(ctx); err != nil {
			return nil, fmt.Errorf("schema: %w", err)
		}
		return pg, nil
	default:
		return nil, fmt.Errorf("unknown --db %q", kind)
	}
}

func openBlob(kind, dir, endpoint, region, bucket, key, secret, prefix string) (blob.Blob, error) {
	switch kind {
	case "fs":
		return blob.NewFS(dir)
	case "spaces":
		if endpoint == "" || bucket == "" || key == "" || secret == "" {
			return nil, fmt.Errorf("--blob=spaces needs endpoint, bucket, key and secret (or SPACES_* env)")
		}
		return blob.NewSpaces(endpoint, region, bucket, key, secret, prefix), nil
	default:
		return nil, fmt.Errorf("unknown --blob %q", kind)
	}
}

func serveAsync(addr string, h http.Handler) *http.Server {
	srv := &http.Server{Addr: addr, Handler: h}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("listen %s: %v", addr, err)
		}
	}()
	return srv
}

func serve(ctx context.Context, addr string, h http.Handler) {
	srv := serveAsync(addr, h)
	if addr == ":9100" || strings.HasSuffix(addr, ":9100") {
		log.Printf("control plane listening on %s", addr)
	}
	<-ctx.Done()
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutCtx)
	log.Print("stopped")
}
