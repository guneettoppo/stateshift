// Package webui embeds the dashboard so the whole control plane ships as one
// binary. No npm, no node_modules, no build step on the demo machine.
package webui

import "embed"

//go:embed index.html
var Files embed.FS
