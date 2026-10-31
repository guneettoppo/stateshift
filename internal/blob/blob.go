// Package blob is the object store abstraction. Two implementations exist so a
// sponsor outage can degrade the demo instead of killing it:
//
//	FS     - local directory, used on a laptop and as the offline fallback
//	Spaces - DigitalOcean Spaces (any S3-compatible endpoint)
package blob

import "context"

// Blob is the minimum surface StateShift needs: put, get, and an existence
// check that makes dedupe cheap.
type Blob interface {
	Put(ctx context.Context, key string, data []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	Has(ctx context.Context, key string) bool
	Name() string
}

// ChunkKey is the content-addressed location of a chunk.
func ChunkKey(hash string) string {
	if len(hash) < 2 {
		return "chunks/" + hash
	}
	return "chunks/" + hash[:2] + "/" + hash
}

// ManifestKey is the location of a checkpoint manifest.
func ManifestKey(jobID string, seq int) string {
	return "manifests/" + jobID + "/" + itoa(seq) + ".json"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
