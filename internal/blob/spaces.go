package blob

import (
	"bytes"
	"context"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Spaces is an S3-compatible object store (DigitalOcean Spaces, MinIO, R2...).
// Always construct it with UsePathStyle, which is what Spaces expects.
type Spaces struct {
	client *s3.Client
	bucket string
	prefix string
}

// NewSpaces builds a client for endpoint like https://blr1.digitaloceanspaces.com
func NewSpaces(endpoint, region, bucket, accessKey, secretKey, prefix string) *Spaces {
	client := s3.New(s3.Options{
		Region:       region,
		BaseEndpoint: aws.String(endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		UsePathStyle: true,
	})
	return &Spaces{client: client, bucket: bucket, prefix: strings.Trim(prefix, "/")}
}

func (s *Spaces) key(k string) string {
	if s.prefix == "" {
		return k
	}
	return s.prefix + "/" + k
}

func (s *Spaces) Put(ctx context.Context, key string, data []byte) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(s.key(key)),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("application/octet-stream"),
	})
	if err != nil {
		return err
	}
	return nil
}

func (s *Spaces) Get(ctx context.Context, key string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(key)),
	})
	if err != nil {
		return nil, err
	}
	defer out.Body.Close()
	return io.ReadAll(out.Body)
}

func (s *Spaces) Has(ctx context.Context, key string) bool {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(s.key(key)),
	})
	return err == nil
}

func (s *Spaces) Name() string { return "spaces://" + s.bucket + "/" + s.prefix }
