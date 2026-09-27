package objectstore

import (
	"context"
	"io"
	"time"
)

type Request struct {
	URL     string
	Headers map[string]string
}

type Metadata struct {
	SizeBytes int64
}

type Store interface {
	PresignUpload(context.Context, string, string, int64, time.Duration) (Request, error)
	PresignDownload(context.Context, string, time.Duration) (Request, error)
	Open(context.Context, string) (io.ReadCloser, Metadata, error)
	Put(context.Context, string, string, io.Reader) error
	Copy(context.Context, string, string) error
	Delete(context.Context, string) error
}
