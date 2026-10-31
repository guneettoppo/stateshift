package blob

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FS is a directory-backed blob store. Used for laptop rehearsal and as the
// fallback when the object store is unreachable.
type FS struct {
	root string
}

func NewFS(root string) (*FS, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	return &FS{root: abs}, nil
}

func (f *FS) path(key string) (string, error) {
	clean := filepath.Clean(strings.ReplaceAll(key, "\\", "/"))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("blob: refusing key %q", key)
	}
	return filepath.Join(f.root, filepath.FromSlash(clean)), nil
}

func (f *FS) Put(_ context.Context, key string, data []byte) error {
	p, err := f.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	// Write-then-rename so a half-written checkpoint can never be observed.
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	_ = os.Remove(p) // Windows rename does not replace an open target
	if err := os.Rename(tmp, p); err != nil {
		return err
	}
	return nil
}

func (f *FS) Get(_ context.Context, key string) ([]byte, error) {
	p, err := f.path(key)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(p)
}

func (f *FS) Has(_ context.Context, key string) bool {
	p, err := f.path(key)
	if err != nil {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && st.Size() > 0
}

func (f *FS) Name() string { return "fs://" + f.root }
