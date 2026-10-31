package workload

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/guneettoppo/stateshift/internal/model"
)

// LLM is the only external dependency of the agent workload, kept behind an
// interface so --llm=mock keeps the demo alive with no network at all.
type LLM interface {
	Generate(ctx context.Context, prompt string) (string, error)
	Name() string
}

// Agent is a long-running tool-calling style agent. Each step is one expensive,
// irreversible external call whose result is recorded in the exactly-once op
// log. This is the workload that makes the pitch concrete: migrating it means
// you do not pay twice for work already done.
type Agent struct {
	Client LLM
}

type agentState struct {
	Total   int      `json:"total"`
	Done    int      `json:"done"`
	Task    string   `json:"task"`
	Turns   []string `json:"turns"`
	Seconds float64  `json:"seconds"`
}

func (a Agent) Name() string { return "agent" }

func (a Agent) Init(params map[string]any) ([]byte, int, error) {
	total := paramInt(params, "steps", 24)
	if total < 4 {
		total = 4
	}
	if total > 500 {
		total = 500
	}
	st := agentState{
		Total: total,
		Task:  paramStr(params, "prompt", "Summarise why exactly-once resumption matters for an AI agent run."),
	}
	raw, err := encode(st)
	return raw, total, err
}

func (a Agent) Step(ctx context.Context, raw []byte) ([]byte, []model.Op, bool, error) {
	st, err := decode[agentState](raw)
	if err != nil {
		return nil, nil, false, err
	}

	var b strings.Builder
	b.WriteString(st.Task)
	b.WriteString("\n\nPrior observations:\n")
	if len(st.Turns) == 0 {
		b.WriteString("(none)\n")
	}
	for i, t := range st.Turns {
		fmt.Fprintf(&b, "%d. %s\n", i+1, t)
	}
	fmt.Fprintf(&b, "\nThis is step %d of %d. Write one short new observation.\n", st.Done+1, st.Total)

	start := time.Now()
	text, err := a.Client.Generate(ctx, b.String())
	if err != nil {
		return nil, nil, false, err
	}
	st.Seconds += time.Since(start).Seconds()

	text = strings.TrimSpace(text)
	if len(text) > 300 {
		text = text[:300]
	}
	st.Turns = append(st.Turns, text)
	st.Done++

	sum := sha256.Sum256([]byte(text))
	op := model.Op{
		ID:     fmt.Sprintf("agent-%06d", st.Done),
		Result: hex.EncodeToString(sum[:8]),
	}

	next, err := encode(st)
	if err != nil {
		return nil, nil, false, err
	}
	return next, []model.Op{op}, st.Done >= st.Total, nil
}

func (a Agent) Checksum(raw []byte) string {
	st, err := decode[agentState](raw)
	if err != nil {
		return ""
	}
	h := sha256.Sum256([]byte(strings.Join(st.Turns, "\x00")))
	return hex.EncodeToString(h[:6])
}

// MockLLM is deterministic and offline: the demo never dies because a free tier
// rate-limited us at 3 AM.
type MockLLM struct{}

func (MockLLM) Name() string { return "mock" }

func (MockLLM) Generate(_ context.Context, prompt string) (string, error) {
	sum := sha256.Sum256([]byte(prompt))
	openers := []string{
		"Checkpoint boundary confirmed; pending effect recorded.",
		"Idempotency key already spent, skipping duplicate call.",
		"Lease holder unchanged, continuing from committed sequence.",
		"Fencing token advanced; stale instance would now abort.",
		"State hash verified against manifest before resume.",
		"Committed op count matches expected sequence position.",
	}
	return fmt.Sprintf("%s (ctx %x)", openers[int(sum[0])%len(openers)], sum[:3]), nil
}

// GeminiLLM talks to the Gemini API over plain HTTP: no SDK, no extra deps.
type GeminiLLM struct {
	Key   string
	Model string
	HTTP  *http.Client
}

func (g *GeminiLLM) Name() string { return "gemini:" + g.Model }

type geminiReq struct {
	Contents         []geminiContent `json:"contents"`
	GenerationConfig struct {
		Temperature     float64 `json:"temperature"`
		MaxOutputTokens int     `json:"maxOutputTokens"`
	} `json:"generationConfig"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiResp struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

func (g *GeminiLLM) Generate(ctx context.Context, prompt string) (string, error) {
	if g.HTTP == nil {
		g.HTTP = &http.Client{Timeout: 30 * time.Second}
	}
	body := geminiReq{Contents: []geminiContent{{Parts: []geminiPart{{Text: prompt}}}}}
	body.GenerationConfig.Temperature = 0.4
	body.GenerationConfig.MaxOutputTokens = 80
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", g.Model, g.Key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := g.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini %d: %s", resp.StatusCode, strings.TrimSpace(string(payload)))
	}

	var out geminiResp
	if err := json.Unmarshal(payload, &out); err != nil {
		return "", err
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: empty candidates")
	}
	return out.Candidates[0].Content.Parts[0].Text, nil
}
