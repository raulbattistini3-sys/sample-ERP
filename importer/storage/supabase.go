package storage

// Supabase Storage through its own REST API (github.com/supabase-community/storage-go), for setups that
// keep the database, the files and the auth in one Supabase project. Same shape as S3 in storage.go, so
// the worker doesn't care which one it gets. The bucket must exist and be private; the service_role key
// bypasses its RLS policies, so it stays on the server and never reaches the browser.
// storage-go's calls take no context, so a cancelled import can't abort an upload or download midway.

// import (
// 	"bytes"
// 	"context"
// 	"fmt"
//
// 	storage_go "github.com/supabase-community/storage-go"
// )
//
// const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//
// type Supabase struct {
// 	client *storage_go.Client
// 	bucket string
// }
//
// // projectURL is https://<project>.supabase.co; serviceRoleKey is the project's service_role secret
// // (SUPABASE_SERVICE_ROLE_KEY), never the anon key.
// func NewSupabase(projectURL, serviceRoleKey, bucket string) *Supabase {
// 	client := storage_go.NewClient(projectURL+"/storage/v1", serviceRoleKey, nil)
// 	return &Supabase{client: client, bucket: bucket}
// }
//
// // Put stores the spreadsheet under importacoes/<id>/<nomeArquivo> and returns that key. Upsert, so a
// // retried IniciarImportacao overwrites its own half-finished upload instead of failing.
// func (s *Supabase) Put(_ context.Context, importacaoID, nomeArquivo string, planilha []byte) (string, error) {
// 	key := fmt.Sprintf("importacoes/%s/%s", importacaoID, nomeArquivo)
// 	contentType, upsert := xlsxContentType, true
// 	_, err := s.client.UploadFile(s.bucket, key, bytes.NewReader(planilha), storage_go.FileOptions{
// 		ContentType: &contentType,
// 		Upsert:      &upsert,
// 	})
// 	if err != nil {
// 		return "", fmt.Errorf("storage: uploading %s: %w", key, err)
// 	}
// 	return key, nil
// }
//
// func (s *Supabase) Get(_ context.Context, key string) ([]byte, error) {
// 	planilha, err := s.client.DownloadFile(s.bucket, key)
// 	if err != nil {
// 		return nil, fmt.Errorf("storage: downloading %s: %w", key, err)
// 	}
// 	return planilha, nil
// }
//
// // Delete runs once the import finishes, the way planilha is cleared today.
// func (s *Supabase) Delete(_ context.Context, key string) error {
// 	_, err := s.client.RemoveFile(s.bucket, []string{key})
// 	return err
// }
