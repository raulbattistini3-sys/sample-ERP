// Please use S3 or an ideal object storage. This is for sample purposes.
// If on a budget, use a local MinIO instance (https://min.io/) instead of Supabase Storage, and point the S3 client at it.
// Supabase Storage is free for small projects, but it is not a good idea to put production data in a free service.
// For local development the .xlsx bytes are kept in importacoes.planilha (bytea), so the stack needs
// nothing but Postgres and any importer instance can process any job. That is the active path: see
// postgres.Importacoes.Criar and Reivindicar.
//
// In production the bytes belong in object storage, with only the object key in the row
// (importacoes.chave_arquivo, see api/drizzle/0011_importacoes.sql). Two alternatives, both commented out:
//   - this file: any S3-compatible store (AWS, MinIO, or Supabase Storage through its S3 endpoint at
//     https://<project>.supabase.co/storage/v1/s3 with the project's S3 access keys).
//     `go get github.com/aws/aws-sdk-go-v2/service/s3 github.com/aws/aws-sdk-go-v2/config`
//   - supabase.go: Supabase's own Storage API, for keeping everything (Postgres, storage, auth) in one
//     Supabase project. `go get github.com/supabase-community/storage-go`
// Either way: uncomment one, upload in IniciarImportacao before Criar, and download in the worker after Reivindicar.
package storage

// import (
// 	"bytes"
// 	"context"
// 	"fmt"
// 	"io"
//
// 	awsconfig "github.com/aws/aws-sdk-go-v2/config"
// 	"github.com/aws/aws-sdk-go-v2/service/s3"
// )
//
// type S3 struct {
// 	client *s3.Client
// 	bucket string
// }
//
// // endpoint is empty for AWS itself; for Supabase Storage it is https://<project>.supabase.co/storage/v1/s3
// func NewS3(ctx context.Context, bucket, endpoint string) (*S3, error) {
// 	cfg, err := awsconfig.LoadDefaultConfig(ctx) // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
// 	if err != nil {
// 		return nil, fmt.Errorf("storage: loading aws config: %w", err)
// 	}
// 	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
// 		if endpoint != "" {
// 			o.BaseEndpoint = &endpoint
// 			o.UsePathStyle = true // Supabase (and MinIO) want bucket/key in the path
// 		}
// 	})
// 	return &S3{client: client, bucket: bucket}, nil
// }
//
// // Put stores the spreadsheet under importacoes/<id>/<nomeArquivo> and returns that key.
// func (s *S3) Put(ctx context.Context, importacaoID, nomeArquivo string, planilha []byte) (string, error) {
// 	key := fmt.Sprintf("importacoes/%s/%s", importacaoID, nomeArquivo)
// 	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
// 		Bucket: &s.bucket,
// 		Key:    &key,
// 		Body:   bytes.NewReader(planilha),
// 	})
// 	if err != nil {
// 		return "", fmt.Errorf("storage: uploading %s: %w", key, err)
// 	}
// 	return key, nil
// }
//
// func (s *S3) Get(ctx context.Context, key string) ([]byte, error) {
// 	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
// 	if err != nil {
// 		return nil, fmt.Errorf("storage: downloading %s: %w", key, err)
// 	}
// 	defer out.Body.Close()
// 	return io.ReadAll(out.Body)
// }
//
// // Delete runs once the import finishes, the way planilha is cleared today.
// func (s *S3) Delete(ctx context.Context, key string) error {
// 	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
// 	return err
// }
