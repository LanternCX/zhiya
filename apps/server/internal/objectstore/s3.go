package objectstore

import (
	"context"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type s3Store struct {
	client    *s3.Client
	presigner *s3.PresignClient
	bucket    string
}

func New(ctx context.Context, settings config.Storage) (Store, error) {
	awsConfig := aws.Config{
		Region:      settings.Region,
		Credentials: credentials.NewStaticCredentialsProvider(settings.AccessKey, settings.SecretKey, ""),
	}
	client := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(settings.Endpoint)
		options.UsePathStyle = true
	})
	publicClient := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(settings.PublicEndpoint)
		options.UsePathStyle = true
	})
	store := &s3Store{client: client, presigner: s3.NewPresignClient(publicClient), bucket: settings.Bucket}
	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &store.bucket}); err != nil {
		if _, err = client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &store.bucket}); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (s *s3Store) PresignUpload(ctx context.Context, key, mediaType string, size int64, expires time.Duration) (Request, error) {
	result, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        &s.bucket,
		Key:           &key,
		ContentType:   &mediaType,
		ContentLength: &size,
	}, func(options *s3.PresignOptions) { options.Expires = expires })
	if err != nil {
		return Request{}, err
	}
	return Request{URL: result.URL, Headers: browserHeaders(result.SignedHeader)}, nil
}

func (s *s3Store) PresignDownload(ctx context.Context, key string, expires time.Duration) (Request, error) {
	result, err := s.presigner.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key}, func(options *s3.PresignOptions) { options.Expires = expires })
	if err != nil {
		return Request{}, err
	}
	return Request{URL: result.URL, Headers: browserHeaders(result.SignedHeader)}, nil
}

func (s *s3Store) Open(ctx context.Context, key string) (io.ReadCloser, Metadata, error) {
	result, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return nil, Metadata{}, err
	}
	return result.Body, Metadata{SizeBytes: aws.ToInt64(result.ContentLength)}, nil
}

func (s *s3Store) Copy(ctx context.Context, source, destination string) error {
	copySource := url.PathEscape(s.bucket + "/" + source)
	_, err := s.client.CopyObject(ctx, &s3.CopyObjectInput{Bucket: &s.bucket, Key: &destination, CopySource: &copySource})
	return err
}

func (s *s3Store) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
	return err
}

func browserHeaders(headers map[string][]string) map[string]string {
	result := make(map[string]string, len(headers))
	for name, values := range headers {
		lower := strings.ToLower(name)
		if len(values) > 0 && (lower == "content-type" || strings.HasPrefix(lower, "x-amz-")) {
			result[name] = values[0]
		}
	}
	return result
}
