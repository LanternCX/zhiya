package main

import (
	"bytes"
	"context"
	"io"

	"github.com/LanternCX/zhiya/apps/server/internal/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type s3ObjectStore struct {
	client *s3.Client
	bucket string
}

func newS3ObjectStore(ctx context.Context, settings config.Storage) (*s3ObjectStore, error) {
	client := s3.NewFromConfig(aws.Config{
		Region:      settings.Region,
		Credentials: credentials.NewStaticCredentialsProvider(settings.AccessKey, settings.SecretKey, ""),
	}, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(settings.Endpoint)
		options.UsePathStyle = true
	})
	store := &s3ObjectStore{client: client, bucket: settings.Bucket}
	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &store.bucket}); err != nil {
		if _, err = client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &store.bucket}); err != nil {
			return nil, err
		}
	}
	return store, nil
}

func (s *s3ObjectStore) Put(ctx context.Context, key string, content []byte, mediaType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      &s.bucket,
		Key:         &key,
		Body:        bytes.NewReader(content),
		ContentType: &mediaType,
	})
	return err
}

func (s *s3ObjectStore) Get(ctx context.Context, key string) ([]byte, error) {
	result, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return nil, err
	}
	defer result.Body.Close()
	return io.ReadAll(result.Body)
}

func (s *s3ObjectStore) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
	return err
}
